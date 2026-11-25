# GlobeFrame – Global Photo Gallery / Portfolio Website

ITE183 – From Concepts to Cloud: An AWS Application Project
Topic: Cloud Data Center / CDN · Region: Asia Pacific (Tokyo) – ap-northeast-1
Group: Macatanong, Abdensa C. · Maguidala, Mohammad Yasser M. · Palantig, Mohammad Hosni U.

---

## 1. Features

### A. Visitor features
| Feature | Description |
|---|---|
| Homepage | Featured photographs and an introduction to GlobeFrame. |
| Photo Gallery | All uploaded photographs in a gallery grid (featured first, then newest). |
| Categories | Browse photos by category, such as Nature, Architecture, Culture and Landscapes. |
| Search | Search photographs by title, location or category (description is searched too). |
| Photo Details | A larger photo with its title, description, location, category and date. Arrow keys move between photos. |
| Responsive Design | Works on computers, tablets and phones. |

### B. Administrator features
| Feature | Description |
|---|---|
| Admin Login | Secure access to the dashboard (hashed password, login attempt limit). |
| Dashboard | Total photos, categories, featured photos, storage used, photos per category and latest upload. |
| Upload Photos | Upload new photographs with title, location, category and description. Stored in S3 once the IAM role is attached (see section 6). |
| Manage Photos | Edit titles, descriptions, locations and categories; feature or unfeature photos; search the list. |
| Delete Photos | Remove photographs from the gallery and from storage (S3 or EC2). |
| Manage Categories | Create, rename and delete categories. Photos in a deleted category move to "Uncategorized". |

### Visitor workflow
1. Visitor opens the GlobeFrame website.
2. CloudFront receives the request.
3. EC2 serves the website and application.
4. Visitor browses categories or searches for photos.
5. CloudFront retrieves the requested images from the private S3 bucket.
6. Visitor views the photographs.

### Administrator workflow
1. Administrator logs in.
2. Opens the admin dashboard.
3. Uploads a photograph and enters its information.
4. The EC2 backend processes the upload and stores the image in S3 using its IAM role.
5. The photo information is saved for gallery display.
6. The new photograph becomes available in the public gallery.

---

## 2. Architecture

```
                         Visitor / Administrator browser
                                       │ https://<distribution>.cloudfront.net
                                       ▼
                      ┌──────── Amazon CloudFront (edge locations) ────────┐
                      │  Default (*)  → EC2 origin   (no caching for /api) │
                      │  /photos/*    → S3 origin    (cached at the edge)  │
                      └───────────┬───────────────────────────┬────────────┘
                                  │ HTTP :80                  │ Origin Access Control
                                  ▼                           ▼
 ┌──────────── Amazon EC2: GlobeFrame-WebServer (Tokyo) ──┐   Amazon S3 (private)
 │  Apache  ├── website files (index.html, admin.html…)   │   group-2-ttuu-cdn-demo-2026/photos/
 │          └── /api/ → Flask backend (127.0.0.1:5000) ───┼──► (upload / delete through the
 └────────────────────────────────────────────────────────┘    EC2 IAM role, no access keys)
```

| Service | Role in GlobeFrame |
|---|---|
| **Amazon CloudFront** | Receives visitor requests; serves the site from EC2 and the photos from S3 through edge locations. |
| **Amazon EC2** | Runs Apache (website) and the Flask backend (login, dashboard, upload, edit, delete). |
| **Amazon S3** | Stores the photographs in a private bucket. |
| **AWS IAM** | The EC2 role lets the backend use S3 without access keys; member policies limit each person's access. |

### Storage modes (one setting, no code changes)

Because CloudFront and the IAM role are still being set up, the app can run in
three modes. Set `IMAGE_MODE` in `/etc/globeframe.env` on the server:

| Mode | Photos stored in | Photos delivered by | Needs |
|---|---|---|---|
| `local` *(default)* | EC2 disk (`/var/www/html/photos`) | Apache on EC2 | Nothing extra – works now |
| `s3` | Private S3 bucket | Short-lived pre-signed S3 links | IAM role attached to the instance |
| `cloudfront` | Private S3 bucket | CloudFront | IAM role + CloudFront distribution |

The About section of the homepage and the admin dashboard show which mode is active.

---

## 3. Folder structure

```
cloudfrount/
├── website/                 Front end (served by Apache)
│   ├── index.html           Visitor homepage, gallery, search, photo details
│   ├── admin.html           Admin login and dashboard
│   ├── css/style.css
│   ├── js/config.js         API location
│   ├── js/api.js            Calls to the backend
│   ├── js/gallery.js        Visitor features
│   └── js/admin.js          Administrator features
├── backend/
│   ├── app.py               Flask API
│   └── requirements.txt
└── deploy/
    ├── setup.sh             One-command installer / updater for EC2
    ├── globeframe.service   Keeps the backend running (systemd)
    ├── globeframe-apache.conf
    ├── iam-role-policy.json S3 permissions for the EC2 role (for the leader)
    └── passrole-policy.json Lets Member 2 attach that role (for the leader)
```

### Backend API

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/photos?q=&category=` | Anyone | List or search photos |
| GET | `/api/categories` | Anyone | Categories with photo counts |
| GET | `/api/health` | Anyone | Status and storage mode |
| POST | `/api/login`, `/api/logout` | Admin | Sign in / out |
| GET | `/api/stats` | Admin | Dashboard statistics |
| POST | `/api/photos` | Admin | Upload a photo (JPG, PNG, GIF, WEBP; max 10 MB) |
| PATCH | `/api/photos/<id>` | Admin | Edit title, location, description, category, featured |
| DELETE | `/api/photos/<id>` | Admin | Delete a photo and its file |
| POST | `/api/categories` | Admin | Create a category |
| PATCH | `/api/categories/<name>` | Admin | Rename a category |
| DELETE | `/api/categories/<name>` | Admin | Delete a category |

---

## 4. Deploy to EC2 (AWS console only)

### Step A – Put the project on GitHub
1. github.com → **New repository** → Public → **Create repository** (leave "Add a README" unchecked).
2. Click **uploading an existing file**.
3. In File Explorer, open `C:\Users\msu-wone\Documents\Codes\cloudfrount`, press **Ctrl+A**, and drag
   everything *inside* the folder onto the page. Do not drag the `cloudfrount` folder itself.
4. Click **Commit changes**. The repository should show `backend`, `deploy`, `website` and `README.md` at the top level.

### Step B – Install on the server
EC2 → Instances → **GlobeFrame-WebServer** → **Connect** → **EC2 Instance Connect** → `ec2-user` → **Connect**:

```bash
sudo dnf install -y git
git clone https://github.com/<your-username>/<repository-name>.git
cd <repository-name>
sudo bash deploy/setup.sh
```
Choose the admin username and password when asked. The installer ends with
`Backend health check: OK` and prints the gallery and admin links.

### Step C – Update after changing the code
1. Upload the changed files to GitHub again: **Add file → Upload files**, drag in the files or
   folders, and **Commit changes**. Files with the same name are replaced.
2. In EC2 Instance Connect:
   ```bash
   cd ~/<repository-name> && git pull && sudo bash deploy/setup.sh
   ```
The admin account, uploaded photos and photo information are kept.

---

## 5. Move photos to S3 (IAM role)

**Leader (IAM):**
1. IAM → Policies → Create policy → JSON → paste `deploy/iam-role-policy.json` → name `GlobeFrame-EC2-S3-Policy`.
2. IAM → Roles → Create role → **AWS service → EC2** → attach `GlobeFrame-EC2-S3-Policy` → name `GlobeFrame-EC2-S3-Role`.
3. Add `deploy/passrole-policy.json` to Member 2's permissions so Member 2 can attach the role.

**Member 2 (EC2):**
1. EC2 → select the instance → **Actions → Security → Modify IAM role** → `GlobeFrame-EC2-S3-Role` → **Update IAM role**.
2. In EC2 Instance Connect:
   ```bash
   aws s3 ls s3://group-2-ttuu-cdn-demo-2026
   sudo aws s3 sync /var/www/html/photos s3://group-2-ttuu-cdn-demo-2026/photos/
   sudo sed -i 's/^S3_BUCKET=.*/S3_BUCKET=group-2-ttuu-cdn-demo-2026/' /etc/globeframe.env
   sudo sed -i 's/^IMAGE_MODE=.*/IMAGE_MODE=s3/' /etc/globeframe.env
   sudo systemctl restart globeframe
   ```
3. The dashboard should now show **Storage: Amazon S3**. New uploads go to the bucket.

---

## 6. Put CloudFront in front (matches the visitor workflow)

Do this after section 5, once the account verification issue is resolved.

**Leader (CloudFront) – create one distribution with two origins:**

| Setting | Value |
|---|---|
| Origin 1 (website) | EC2 public DNS, e.g. `ec2-43-207-181-11.ap-northeast-1.compute.amazonaws.com` · Protocol **HTTP only**, port 80 |
| Origin 2 (photos) | S3 bucket `group-2-ttuu-cdn-demo-2026` · **Origin access control** (create new OAC) · then apply the bucket policy CloudFront offers |
| Default behavior `*` → Origin 1 | Viewer protocol: **Redirect HTTP to HTTPS** · Allowed methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** · Cache policy: **CachingDisabled** · Origin request policy: **AllViewer** |
| Behavior `/photos/*` → Origin 2 | Viewer protocol: Redirect HTTP to HTTPS · Allowed methods: GET, HEAD · Cache policy: **CachingOptimized** |
| Web Application Firewall | Do not enable security protections (the account lacks `wafv2:CreateWebACL`) |

> The EC2 public DNS changes if the instance is stopped and started. Attaching an
> Elastic IP keeps it fixed; otherwise update Origin 1 after each restart.

**Member 2 (EC2):**
```bash
sudo sed -i 's/^IMAGE_MODE=.*/IMAGE_MODE=cloudfront/' /etc/globeframe.env
echo "COOKIE_SECURE=1" | sudo tee -a /etc/globeframe.env
sudo systemctl restart globeframe
```
Then open the site at **https://&lt;distribution&gt;.cloudfront.net** and use that address from
now on, including for `/admin.html`. With `COOKIE_SECURE=1`, admin login works only over HTTPS.
Photo links become `/photos/...` on the CloudFront domain and are served from S3 through the edge.

*Alternative:* to keep opening the site on EC2 but deliver only the photos through CloudFront,
create just Origin 2 and set `CLOUDFRONT_DOMAIN=<distribution>.cloudfront.net` instead (skip `COOKIE_SECURE`).

---

## 7. Run it on your own computer (optional)

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

## 8. Troubleshooting

| Problem | Check |
|---|---|
| Site does not load | Security group allows HTTP 80; `sudo systemctl status httpd` |
| "Cannot reach the server" | `sudo systemctl status globeframe` and `sudo journalctl -u globeframe -n 50` |
| "AWS access denied" when uploading | The IAM role is not attached, or it lacks the S3 permissions |
| Photos broken after switching to `cloudfront` | Behavior `/photos/*` and the OAC bucket policy in CloudFront |
| Admin login does nothing after enabling `COOKIE_SECURE=1` | Open the site through the `https://…cloudfront.net` address, not the EC2 IP |
| Forgot the admin password | `sudo rm /etc/globeframe.env && sudo bash deploy/setup.sh` (photos are kept; set IMAGE_MODE again afterwards) |
| Site address changed | The public IP changes after a stop/start. Check the instance Details tab. |

## 9. Security notes
- The admin password is stored only as a hash in `/etc/globeframe.env` (readable by root only).
- The backend listens only on `127.0.0.1`, so it cannot be reached directly from the internet.
- Login is limited to 5 failed attempts per 5 minutes. Admin actions need a session cookie and a custom request header.
- Uploads are checked for real image content and limited to 10 MB.
- No AWS access keys are stored: the backend gets S3 access from the EC2 IAM role, and the bucket stays private.
