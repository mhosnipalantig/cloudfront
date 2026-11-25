# GlobeFrame – Global Photo Gallery / Portfolio Website

ITE183 – From Concepts to Cloud: An AWS Application Project
Topic: Cloud Data Center / CDN · Region: Asia Pacific (Tokyo) – ap-northeast-1
Group: Macatanong, Abdensa C. · Maguidala, Mohammad Yasser M. · Palantig, Mohammad Hosni U.

GlobeFrame lets **visitors** browse photographs by collection and view them in a
full-screen viewer, while an **administrator** logs in to upload, edit, feature and
remove photos.

---

## 1. How it uses AWS

```
 Visitor / Admin browser
          │  http://<EC2 public IP>
          ▼
 ┌──────────────────────── Amazon EC2 (GlobeFrame-WebServer, Tokyo) ─────────────────────┐
 │  Apache (port 80)                                                                     │
 │   ├── serves website/  (index.html, admin.html, css, js)                              │
 │   ├── serves /photos/  (only in "local" mode)                                         │
 │   └── forwards /api/ ──► Flask backend (127.0.0.1:5000, run by Gunicorn)              │
 └───────────────────────────────────────────┬───────────────────────────────────────────┘
                                             │ IAM role (no keys stored on the server)
                                             ▼
                         Amazon S3: globeframe-photos-2026/photos/
                                             ▲
                                             │ Origin Access Control (private bucket)
                         Amazon CloudFront ──┘  delivers images from edge locations
```

| Service | Role in GlobeFrame |
|---|---|
| **Amazon EC2** | Runs Apache (website) and the Flask backend (admin functions). |
| **Amazon S3** | Stores the photos (`photos/` folder in `globeframe-photos-2026`). |
| **Amazon CloudFront** | Delivers the photos from edge locations close to visitors. |
| **AWS IAM** | EC2 role lets the backend use S3 without access keys; member policies limit each person's access. |

### Image modes (one setting, no code changes)

The backend setting `IMAGE_MODE` in `/etc/globeframe.env` decides where photos live:

| Mode | Photos stored in | Photos delivered by | Needs |
|---|---|---|---|
| `local` *(default)* | EC2 disk (`/var/www/html/photos`) | Apache on EC2 | Nothing extra – works now |
| `s3` | S3 bucket | Short-lived pre-signed S3 links (bucket stays private) | IAM role attached to the instance |
| `cloudfront` | S3 bucket | CloudFront (`https://<domain>/photos/...`) | IAM role + CloudFront distribution |

This lets the project work today, then move to S3 and CloudFront as those parts
are finished.

---

## 2. Folder structure

```
cloudfrount/
├── website/                 Front end (served by Apache)
│   ├── index.html           Visitor gallery
│   ├── admin.html           Administrator dashboard
│   ├── css/style.css
│   ├── js/config.js         API location
│   ├── js/api.js            Calls to the backend
│   ├── js/gallery.js        Gallery, filters, lightbox
│   └── js/admin.js          Login, upload, edit, feature, remove
├── backend/
│   ├── app.py               Flask API
│   └── requirements.txt
└── deploy/
    ├── setup.sh             One-command installer for EC2
    ├── globeframe.service   Keeps the backend running (systemd)
    ├── globeframe-apache.conf
    ├── iam-role-policy.json S3 permissions for the EC2 role (for the leader)
    └── passrole-policy.json Lets Member 2 attach that role (for the leader)
```

### Backend API

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/photos` | Anyone | List photos (featured first) |
| GET | `/api/collections` | Anyone | List collections |
| GET | `/api/health` | Anyone | Status and current image mode |
| POST | `/api/login` / `/api/logout` | Admin | Sign in / out |
| POST | `/api/photos` | Admin | Upload a photo (JPG, PNG, GIF, WEBP, max 10 MB) |
| PATCH | `/api/photos/<id>` | Admin | Edit title, description, collection, featured |
| DELETE | `/api/photos/<id>` | Admin | Remove a photo and its file |

---

## 3. Deploy to EC2 (AWS console only)

You need: the GlobeFrame-WebServer instance running in Tokyo, with HTTP (port 80)
open in its security group. Both are already set up.

### Step A – Put the project on GitHub (on your computer)

**Option 1: GitHub website, no Git needed**
1. Sign in at github.com → **New repository** → name it `globeframe` → **Public** → **Create repository**.
2. Click **uploading an existing file**, drag in **everything inside** the `cloudfrount` folder
   (the `website`, `backend` and `deploy` folders, `README.md`, `.gitignore`) → **Commit changes**.

**Option 2: Git command line (PowerShell)**
```powershell
cd C:\Users\msu-wone\Documents\Codes\cloudfrount
git init
git add .
git commit -m "GlobeFrame photo gallery"
git branch -M main
git remote add origin https://github.com/<your-username>/globeframe.git
git push -u origin main
```

> The repository holds no passwords or keys. The admin password is only created on
> the server in Step B, so a public repository is fine.

### Step B – Install on the server (EC2 Instance Connect)

EC2 → Instances → **GlobeFrame-WebServer** → **Connect** → **EC2 Instance Connect** →
username `ec2-user` → **Connect**. Then run:

```bash
sudo dnf install -y git
git clone https://github.com/<your-username>/globeframe.git
cd globeframe
sudo bash deploy/setup.sh
```

The installer asks you to **choose an admin username and password**. When it
finishes it prints the links, for example:

```
GlobeFrame installed. Backend health check: OK
  Gallery:  http://43.207.181.11/
  Admin:    http://43.207.181.11/admin.html
```

> The installer replaces the old test page (`index.html`) with the GlobeFrame site.

### Step C – Try it
1. Open **http://&lt;public-ip&gt;/admin.html**, log in, and upload a few photos.
2. Open **http://&lt;public-ip&gt;/** to see them in the gallery.

### Updating after you change the code
Push the changes to GitHub, then in Instance Connect:
```bash
cd ~/globeframe && git pull && sudo bash deploy/setup.sh
```
Your admin account and uploaded photos are kept.

---

## 4. Move photos to S3 (when the IAM role is ready)

**Leader (IAM):**
1. IAM → Policies → Create policy → JSON → paste `deploy/iam-role-policy.json` → name `GlobeFrame-EC2-S3-Policy`.
2. IAM → Roles → Create role → **AWS service → EC2** → attach `GlobeFrame-EC2-S3-Policy` → name `GlobeFrame-EC2-S3-Role`.
3. Add `deploy/passrole-policy.json` to Member 2's permissions so Member 2 can attach the role.

**Member 2 (EC2):**
1. EC2 → select the instance → **Actions → Security → Modify IAM role** → `GlobeFrame-EC2-S3-Role` → **Update IAM role**.
2. In Instance Connect, test the access, copy any existing photos, and switch the mode:
   ```bash
   aws s3 ls s3://globeframe-photos-2026
   sudo aws s3 sync /var/www/html/photos s3://globeframe-photos-2026/photos/
   sudo sed -i 's/^IMAGE_MODE=.*/IMAGE_MODE=s3/' /etc/globeframe.env
   sudo systemctl restart globeframe
   ```
3. Refresh the gallery. The About section should say *"Images served from Amazon S3"*.

## 5. Deliver photos through CloudFront (when CloudFront is unblocked)

**Leader (CloudFront):** create the distribution with origin `globeframe-photos-2026`
and **Origin Access Control**, and apply the bucket policy CloudFront offers. Copy the
distribution domain name, for example `d1234abcd.cloudfront.net`.

**Member 2 (EC2):**
```bash
sudo sed -i 's/^IMAGE_MODE=.*/IMAGE_MODE=cloudfront/' /etc/globeframe.env
sudo sed -i 's/^CLOUDFRONT_DOMAIN=.*/CLOUDFRONT_DOMAIN=d1234abcd.cloudfront.net/' /etc/globeframe.env
sudo systemctl restart globeframe
```
The photo links now point to CloudFront edge locations. The About section should say
*"Images delivered by Amazon CloudFront"*.

---

## 6. Run it on your own computer (optional)

```powershell
cd C:\Users\msu-wone\Documents\Codes\cloudfrount\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:ADMIN_PASSWORD_HASH = python -c "from werkzeug.security import generate_password_hash as g; print(g('test1234'))"
$env:DATA_DIR = "..\local-data"; $env:LOCAL_PHOTO_DIR = "..\local-photos"; $env:SERVE_STATIC_DIR = "..\website"
python app.py
```
Open http://127.0.0.1:5000 (admin login: `admin` / `test1234`).

---

## 7. Troubleshooting

| Problem | Check |
|---|---|
| Site does not load | Security group allows HTTP 80; `sudo systemctl status httpd` |
| "Cannot reach the server" in the gallery | `sudo systemctl status globeframe` and `sudo journalctl -u globeframe -n 50` |
| "AWS access denied" when uploading | The IAM role is not attached, or it lacks the S3 permissions |
| Forgot the admin password | `sudo rm /etc/globeframe.env && sudo bash deploy/setup.sh` (photos are kept) |
| Site address changed | The public IP changes after a stop/start. Check it on the instance Details tab. |

## 8. Security notes
- The admin password is stored only as a hash in `/etc/globeframe.env` (readable by root only).
- The backend listens only on `127.0.0.1`, so it is not reachable directly from the internet.
- Login is limited to 5 failed attempts per 5 minutes per address. Admin actions need a session cookie and a custom request header.
- Uploads are checked for real image content and limited to 10 MB.
- No AWS access keys are used: the backend gets S3 access from the EC2 IAM role.
- The site uses HTTP for now. Once served over HTTPS (for example through CloudFront), set `COOKIE_SECURE=1` in `/etc/globeframe.env`.
