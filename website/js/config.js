// GlobeFrame front-end settings.
// API_BASE is where Apache forwards requests to the Flask backend on EC2.
// Image locations (EC2, S3 or CloudFront) are decided by the backend setting
// IMAGE_MODE in /etc/globeframe.env, so this file rarely needs changing.
window.GLOBEFRAME = {
  API_BASE: "/api",
  SITE_NAME: "GlobeFrame",
};
