"""
GlobeFrame backend - Flask API for the Global Photo Gallery / Portfolio Website.

Runs on the EC2 web server behind Apache (Apache forwards /api/* to this app).

Image storage modes (set IMAGE_MODE in /etc/globeframe.env):
  local       Photos are saved on the EC2 instance in /var/www/html/photos and
              served by Apache. Works without any extra AWS permissions.
  s3          Photos are saved in the S3 bucket. Visitors get short-lived
              pre-signed URLs, so the bucket can stay private.
              Requires an IAM role attached to the EC2 instance.
  cloudfront  Photos are saved in the S3 bucket and delivered through the
              CloudFront distribution (CLOUDFRONT_DOMAIN). Requires the IAM role
              and a working CloudFront distribution with the bucket as origin.
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
S3_BUCKET = os.environ.get("S3_BUCKET", "globeframe-photos-2026")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "").strip().rstrip("/")
DATA_DIR = os.environ.get("DATA_DIR", "/var/lib/globeframe")
LOCAL_PHOTO_DIR = os.environ.get("LOCAL_PHOTO_DIR", "/var/www/html/photos")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))
# Optional: let Flask serve the website folder too (local testing only).
SERVE_STATIC_DIR = os.environ.get("SERVE_STATIC_DIR", "")

KEY_PREFIX = "photos/"          # same key layout locally and in S3
PRESIGN_SECONDS = 3600
ALLOWED_TYPES = {               # extension -> (content type, magic bytes check)
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
}
DEFAULT_COLLECTIONS = ["Landscapes", "Portraits", "Street", "Nature", "Architecture"]

if IMAGE_MODE not in ("local", "s3", "cloudfront"):
    raise SystemExit(f"Unknown IMAGE_MODE '{IMAGE_MODE}'. Use local, s3 or cloudfront.")
if IMAGE_MODE == "cloudfront" and not CLOUDFRONT_DOMAIN:
    raise SystemExit("IMAGE_MODE=cloudfront needs CLOUDFRONT_DOMAIN (e.g. d1234abcd.cloudfront.net).")

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
            return json.load(f)
    except FileNotFoundError:
        return {"photos": [], "collections": list(DEFAULT_COLLECTIONS)}


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
        return f"https://{CLOUDFRONT_DOMAIN}/{key}"
    return s3().generate_presigned_url(
        "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=PRESIGN_SECONDS)


def public(photo):
    p = {k: photo[k] for k in ("id", "title", "description", "collection", "featured", "uploaded_at")}
    p["url"] = image_url(photo["key"])
    return p


# ---------------------------------------------------------------- security helpers
_failed_logins = {}  # ip -> [timestamps]


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
    return (text or "").strip()[:limit]


def parse_bool(v):
    return str(v).lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- public API
@app.get("/api/health")
def health():
    return jsonify(status="ok", image_mode=IMAGE_MODE, region=AWS_REGION)


@app.get("/api/photos")
def list_photos():
    db = load_db()
    photos = db["photos"]
    coll = request.args.get("collection")
    if coll:
        photos = [p for p in photos if p["collection"] == coll]
    # featured first, then newest first
    photos = sorted(photos, key=lambda p: p["uploaded_at"], reverse=True)
    photos = sorted(photos, key=lambda p: not p["featured"])
    return jsonify(photos=[public(p) for p in photos])


@app.get("/api/collections")
def list_collections():
    db = load_db()
    used = {p["collection"] for p in db["photos"]}
    return jsonify(collections=sorted(set(db["collections"]) | used))


# ---------------------------------------------------------------- auth
@app.post("/api/login")
def login():
    # Apache appends the real client address as the last X-Forwarded-For entry.
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[-1].strip()
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


# ---------------------------------------------------------------- admin API
@app.post("/api/photos")
@require_admin
def upload_photo():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Choose an image file to upload."), 400
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_TYPES:
        return jsonify(error="Only JPG, PNG, GIF or WEBP images are allowed."), 400
    body = f.read()
    ctype = detect_image(body[:16])
    if ctype is None:
        return jsonify(error="The file is not a valid image."), 400

    title = clean(request.form.get("title"), 120) or f.filename.rsplit(".", 1)[0][:120]
    collection = clean(request.form.get("collection"), 60) or "Uncategorized"
    key = f"{KEY_PREFIX}{uuid.uuid4().hex}.{'jpg' if ext == 'jpeg' else ext}"

    if IMAGE_MODE == "local":
        os.makedirs(LOCAL_PHOTO_DIR, exist_ok=True)
        with open(os.path.join(LOCAL_PHOTO_DIR, os.path.basename(key)), "wb") as out:
            out.write(body)
    else:
        s3().put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType=ctype,
                        CacheControl="public, max-age=86400")

    photo = {
        "id": uuid.uuid4().hex[:12],
        "key": key,
        "title": title,
        "description": clean(request.form.get("description"), 1000),
        "collection": collection,
        "featured": parse_bool(request.form.get("featured")),
        "content_type": ctype,
        "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    with _lock:
        db = load_db()
        db["photos"].append(photo)
        if collection not in db["collections"]:
            db["collections"].append(collection)
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
        if "collection" in data:
            photo["collection"] = clean(data["collection"], 60) or "Uncategorized"
            if photo["collection"] not in db["collections"]:
                db["collections"].append(photo["collection"])
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
        db["photos"] = [p for p in db["photos"] if p["id"] != pid]
        save_db(db)
    if IMAGE_MODE == "local":
        try:
            os.remove(os.path.join(LOCAL_PHOTO_DIR, os.path.basename(photo["key"])))
        except FileNotFoundError:
            pass
    else:
        s3().delete_object(Bucket=S3_BUCKET, Key=photo["key"])
    return jsonify(ok=True)


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error=f"File is too large (maximum {MAX_UPLOAD_MB} MB)."), 413


@app.errorhandler(Exception)
def server_error(e):
    code = getattr(e, "code", 500)
    if code == 500:
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
