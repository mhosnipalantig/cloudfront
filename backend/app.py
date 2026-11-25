"""
GlobeFrame backend - Flask API for the Global Photo Gallery / Portfolio Website.

Runs on the EC2 web server behind Apache (Apache forwards /api/* to this app).

Image storage modes (set IMAGE_MODE in /etc/globeframe.env):
  local       Photos are saved on the EC2 instance in /var/www/html/photos and
              served by Apache. Works without any extra AWS permissions.
  s3          Photos are saved in the private S3 bucket. Visitors get short-lived
              pre-signed URLs. Requires an IAM role attached to the EC2 instance.
  cloudfront  Photos are saved in the private S3 bucket and delivered by CloudFront.
              - CLOUDFRONT_DOMAIN empty: CloudFront is in front of the whole site
                (default behavior -> EC2, /photos/* -> S3), so image links are
                relative (/photos/...).
              - CLOUDFRONT_DOMAIN set (e.g. d1234.cloudfront.net): image links point
                to that distribution while the site itself is opened on EC2.
              Requires the IAM role and a working CloudFront distribution.
"""

import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.security import check_password_hash

# ---------------------------------------------------------------- settings
IMAGE_MODE = os.environ.get("IMAGE_MODE", "local").strip().lower()
S3_BUCKET = os.environ.get("S3_BUCKET", "group-2-ttuu-cdn-demo-2026")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "").strip().rstrip("/")
DATA_DIR = os.environ.get("DATA_DIR", "/var/lib/globeframe")
LOCAL_PHOTO_DIR = os.environ.get("LOCAL_PHOTO_DIR", "/var/www/html/photos")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))
SERVE_STATIC_DIR = os.environ.get("SERVE_STATIC_DIR", "")  # local testing only

KEY_PREFIX = "photos/"          # same key layout locally and in S3
PRESIGN_SECONDS = 3600
ALLOWED_EXT = {"jpg", "jpeg", "png", "gif", "webp"}
DEFAULT_CATEGORIES = ["Nature", "Architecture", "Culture", "Landscapes"]
UNCATEGORIZED = "Uncategorized"

if IMAGE_MODE not in ("local", "s3", "cloudfront"):
    raise SystemExit(f"Unknown IMAGE_MODE '{IMAGE_MODE}'. Use local, s3 or cloudfront.")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
    MAX_CONTENT_LENGTH=MAX_UPLOAD_MB * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",  # set 1 once served over HTTPS
    PERMANENT_SESSION_LIFETIME=8 * 3600,
)

_lock = threading.Lock()
_s3 = None


def s3():
    global _s3
    if _s3 is None:
        import boto3  # imported lazily so local mode does not need AWS access
        _s3 = boto3.client("s3", region_name=AWS_REGION)
    return _s3


# ---------------------------------------------------------------- metadata store
DB_FILE = os.path.join(DATA_DIR, "photos.json")


def load_db():
    try:
        with open(DB_FILE, "r", encoding="utf-8") as f:
            db = json.load(f)
    except FileNotFoundError:
        db = {}
    # migrate data saved by the first version ("collections" -> "categories")
    cats = db.get("categories", db.pop("collections", None))
    db["categories"] = list(cats) if cats is not None else list(DEFAULT_CATEGORIES)
    db.setdefault("photos", [])
    for p in db["photos"]:
        if "category" not in p:
            p["category"] = p.pop("collection", UNCATEGORIZED)
        p.setdefault("location", "")
        p.setdefault("size", 0)
        if p["category"] not in db["categories"]:
            db["categories"].append(p["category"])
    return db


def save_db(db):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DB_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)
    os.replace(tmp, DB_FILE)


def image_url(key):
    if IMAGE_MODE == "local":
        return "/" + key
    if IMAGE_MODE == "cloudfront":
        return f"https://{CLOUDFRONT_DOMAIN}/{key}" if CLOUDFRONT_DOMAIN else "/" + key
    return s3().generate_presigned_url(
        "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=PRESIGN_SECONDS)


def public(photo):
    p = {k: photo[k] for k in ("id", "title", "description", "location", "category", "featured", "uploaded_at")}
    p["url"] = image_url(photo["key"])
    return p


def sort_photos(photos):
    photos = sorted(photos, key=lambda p: p["uploaded_at"], reverse=True)   # newest first
    return sorted(photos, key=lambda p: not p["featured"])                  # featured first


def matches(photo, q):
    q = q.lower()
    return any(q in (photo.get(f) or "").lower() for f in ("title", "location", "category", "description"))


# ---------------------------------------------------------------- security helpers
_failed_logins = {}  # ip -> [timestamps]


def client_ip():
    # Apache appends the real client address as the last X-Forwarded-For entry.
    return request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[-1].strip()


def too_many_attempts(ip):
    now = time.time()
    recent = [t for t in _failed_logins.get(ip, []) if now - t < 300]
    _failed_logins[ip] = recent
    return len(recent) >= 5


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("admin"):
            return jsonify(error="Please log in as administrator."), 401
        # Simple CSRF protection: browsers cannot send this header cross-site without CORS.
        if request.method != "GET" and request.headers.get("X-Requested-With") != "GlobeFrame":
            return jsonify(error="Missing request header."), 400
        return fn(*args, **kwargs)
    return wrapper


def detect_image(head):
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def clean(text, limit):
    """Trim text; short fields (titles, names) are also collapsed to one line."""
    text = str(text or "")
    return " ".join(text.split())[:limit] if limit <= 120 else text.strip()[:limit]


def parse_bool(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def find_category(db, name):
    return next((c for c in db["categories"] if c.lower() == name.lower()), None)


def ensure_category(db, name):
    name = clean(name, 60) or UNCATEGORIZED
    existing = find_category(db, name)
    if existing:
        return existing
    db["categories"].append(name)
    return name


# ---------------------------------------------------------------- public API
@app.get("/api/health")
def health():
    return jsonify(status="ok", image_mode=IMAGE_MODE, region=AWS_REGION)


@app.get("/api/photos")
def list_photos():
    photos = load_db()["photos"]
    cat = request.args.get("category")
    q = (request.args.get("q") or "").strip()
    if cat:
        photos = [p for p in photos if p["category"] == cat]
    if q:
        photos = [p for p in photos if matches(p, q)]
    return jsonify(photos=[public(p) for p in sort_photos(photos)])


@app.get("/api/categories")
def list_categories():
    db = load_db()
    counts = {}
    for p in db["photos"]:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    return jsonify(categories=[{"name": c, "count": counts.get(c, 0)}
                               for c in sorted(db["categories"], key=str.lower)])


# ---------------------------------------------------------------- auth
@app.post("/api/login")
def login():
    ip = client_ip()
    if too_many_attempts(ip):
        return jsonify(error="Too many attempts. Try again in 5 minutes."), 429
    data = request.get_json(silent=True) or {}
    ok = (ADMIN_PASSWORD_HASH
          and secrets.compare_digest(str(data.get("username", "")), ADMIN_USERNAME)
          and check_password_hash(ADMIN_PASSWORD_HASH, str(data.get("password", ""))))
    if not ok:
        _failed_logins.setdefault(ip, []).append(time.time())
        return jsonify(error="Incorrect username or password."), 401
    session.clear()
    session["admin"] = True
    session.permanent = True
    return jsonify(ok=True, username=ADMIN_USERNAME)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(admin=bool(session.get("admin")), username=ADMIN_USERNAME if session.get("admin") else None)


# ---------------------------------------------------------------- admin: dashboard
@app.get("/api/stats")
@require_admin
def stats():
    db = load_db()
    photos = db["photos"]
    per_cat = {c: 0 for c in db["categories"]}
    for p in photos:
        per_cat[p["category"]] = per_cat.get(p["category"], 0) + 1
    latest = max(photos, key=lambda p: p["uploaded_at"]) if photos else None
    return jsonify(
        total_photos=len(photos),
        total_categories=len(db["categories"]),
        featured_photos=sum(1 for p in photos if p["featured"]),
        photos_with_location=sum(1 for p in photos if p.get("location")),
        storage_bytes=sum(p.get("size", 0) for p in photos),
        latest_upload={"title": latest["title"], "uploaded_at": latest["uploaded_at"]} if latest else None,
        per_category=[{"name": k, "count": v}
                      for k, v in sorted(per_cat.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        image_mode=IMAGE_MODE,
        bucket=S3_BUCKET if IMAGE_MODE != "local" else None,
    )


# ---------------------------------------------------------------- admin: photos
@app.post("/api/photos")
@require_admin
def upload_photo():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Choose an image file to upload."), 400
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_EXT:
        return jsonify(error="Only JPG, PNG, GIF or WEBP images are allowed."), 400
    body = f.read()
    ctype = detect_image(body[:16])
    if ctype is None:
        return jsonify(error="The file is not a valid image."), 400

    title = clean(request.form.get("title"), 120) or f.filename.rsplit(".", 1)[0][:120]
    key = f"{KEY_PREFIX}{uuid.uuid4().hex}.{'jpg' if ext == 'jpeg' else ext}"

    if IMAGE_MODE == "local":
        os.makedirs(LOCAL_PHOTO_DIR, exist_ok=True)
        with open(os.path.join(LOCAL_PHOTO_DIR, os.path.basename(key)), "wb") as out:
            out.write(body)
    else:
        s3().put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType=ctype,
                        CacheControl="public, max-age=86400")

    with _lock:
        db = load_db()
        photo = {
            "id": uuid.uuid4().hex[:12],
            "key": key,
            "title": title,
            "description": clean(request.form.get("description"), 1000),
            "location": clean(request.form.get("location"), 120),
            "category": ensure_category(db, request.form.get("category")),
            "featured": parse_bool(request.form.get("featured")),
            "content_type": ctype,
            "size": len(body),
            "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        db["photos"].append(photo)
        save_db(db)
    return jsonify(photo=public(photo)), 201


@app.patch("/api/photos/<pid>")
@require_admin
def edit_photo(pid):
    data = request.get_json(silent=True) or {}
    with _lock:
        db = load_db()
        photo = next((p for p in db["photos"] if p["id"] == pid), None)
        if not photo:
            return jsonify(error="Photo not found."), 404
        if "title" in data:
            photo["title"] = clean(data["title"], 120) or photo["title"]
        if "description" in data:
            photo["description"] = clean(data["description"], 1000)
        if "location" in data:
            photo["location"] = clean(data["location"], 120)
        if "category" in data:
            photo["category"] = ensure_category(db, data["category"])
        if "featured" in data:
            photo["featured"] = parse_bool(data["featured"])
        save_db(db)
    return jsonify(photo=public(photo))


@app.delete("/api/photos/<pid>")
@require_admin
def delete_photo(pid):
    with _lock:
        db = load_db()
        photo = next((p for p in db["photos"] if p["id"] == pid), None)
        if not photo:
            return jsonify(error="Photo not found."), 404
        if IMAGE_MODE == "local":
            try:
                os.remove(os.path.join(LOCAL_PHOTO_DIR, os.path.basename(photo["key"])))
            except FileNotFoundError:
                pass
        else:
            s3().delete_object(Bucket=S3_BUCKET, Key=photo["key"])
        db["photos"] = [p for p in db["photos"] if p["id"] != pid]
        save_db(db)
    return jsonify(ok=True)


# ---------------------------------------------------------------- admin: categories
@app.post("/api/categories")
@require_admin
def create_category():
    name = clean((request.get_json(silent=True) or {}).get("name"), 60)
    if not name:
        return jsonify(error="Enter a category name."), 400
    with _lock:
        db = load_db()
        if find_category(db, name):
            return jsonify(error=f'Category "{name}" already exists.'), 409
        db["categories"].append(name)
        save_db(db)
    return jsonify(category={"name": name, "count": 0}), 201


@app.patch("/api/categories/<path:name>")
@require_admin
def rename_category(name):
    new = clean((request.get_json(silent=True) or {}).get("name"), 60)
    if not new:
        return jsonify(error="Enter a new category name."), 400
    with _lock:
        db = load_db()
        old = find_category(db, name)
        if not old:
            return jsonify(error="Category not found."), 404
        clash = find_category(db, new)
        if clash and clash != old:
            return jsonify(error=f'Category "{new}" already exists.'), 409
        db["categories"] = [new if c == old else c for c in db["categories"]]
        moved = 0
        for p in db["photos"]:
            if p["category"] == old:
                p["category"] = new
                moved += 1
        save_db(db)
    return jsonify(category={"name": new, "count": moved})


@app.delete("/api/categories/<path:name>")
@require_admin
def delete_category(name):
    with _lock:
        db = load_db()
        old = find_category(db, name)
        if not old:
            return jsonify(error="Category not found."), 404
        if old == UNCATEGORIZED and any(p["category"] == UNCATEGORIZED for p in db["photos"]):
            return jsonify(error="Uncategorized still has photos. Move them to another category first."), 409
        db["categories"] = [c for c in db["categories"] if c != old]
        moved = 0
        for p in db["photos"]:
            if p["category"] == old:
                p["category"] = UNCATEGORIZED
                moved += 1
        if moved and UNCATEGORIZED not in db["categories"]:
            db["categories"].append(UNCATEGORIZED)
        save_db(db)
    return jsonify(ok=True, moved_to_uncategorized=moved)


# ---------------------------------------------------------------- errors
@app.errorhandler(413)
def too_large(_e):
    return jsonify(error=f"File is too large (maximum {MAX_UPLOAD_MB} MB)."), 413


@app.errorhandler(Exception)
def server_error(e):
    code = getattr(e, "code", 500)
    if not isinstance(code, int) or code == 500:
        app.logger.exception("Unhandled error")
        msg = "Server error. Check: sudo journalctl -u globeframe -n 50"
        if IMAGE_MODE != "local" and ("AccessDenied" in str(e) or "NoCredentials" in type(e).__name__):
            msg = "AWS access denied. Is the IAM role attached to the EC2 instance?"
        return jsonify(error=msg), 500
    return jsonify(error=str(getattr(e, "description", e))), code


# ---------------------------------------------------------------- local testing only
if SERVE_STATIC_DIR:
    @app.get("/")
    @app.get("/<path:path>")
    def static_site(path="index.html"):
        if path.startswith("photos/"):
            return send_from_directory(LOCAL_PHOTO_DIR, path[len("photos/"):])
        return send_from_directory(SERVE_STATIC_DIR, path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))
