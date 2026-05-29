# How to Download & Use Thalamus VM Launcher

## Quick Start (3 Steps)

### 1️⃣ Download the Executable

**Windows:**
```
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-windows.exe
```

**macOS:**
```
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-macos
```

**Linux:**
```
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-linux
```

### 2️⃣ Run It

**Windows:**
- Double-click `thalamus-vm-windows.exe`
- If Windows Defender shows warning → Click "More info" → "Run anyway"

**macOS:**
```bash
chmod +x ~/Downloads/thalamus-vm-macos
~/Downloads/thalamus-vm-macos
```

**Linux:**
```bash
chmod +x ~/Downloads/thalamus-vm-linux
~/Downloads/thalamus-vm-linux
```

### 3️⃣ Done!

You'll see:
```
╔══════════════════════════════════════╗
║   Thalamus Virtualization Engine    ║
║            Version 1.0.0             ║
╚══════════════════════════════════════╝

✅ Virtualization runtime ready
🌐 WebSocket server: ws://localhost:5900
```

Now go to Thalamus web app and click "Boot VM" - it will work automatically!

---

## How We Host It (For Developers)

### Option 1: GitHub Releases (Recommended - FREE)

1. **Create GitHub Repository:**
```bash
cd qemu-bridge
git init
git add .
git commit -m "Initial commit"
gh repo create thalamus-vm --public --source=. --push
```

2. **Build All Executables:**
```bash
npm run package
```

This creates:
- `builds/thalamus-vm-windows.exe` (~50MB)
- `builds/thalamus-vm-macos` (~50MB)
- `builds/thalamus-vm-linux` (~45MB)

3. **Create GitHub Release:**
```bash
gh release create v1.0.0 \
  builds/thalamus-vm-windows.exe \
  builds/thalamus-vm-macos \
  builds/thalamus-vm-linux \
  --title "Thalamus VM Launcher v1.0.0" \
  --notes "One-click VM launcher. No Node.js required. Just download and run!"
```

4. **Download URLs:**
```
Windows: https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-windows.exe
macOS:   https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-macos
Linux:   https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-linux
```

**Benefits:**
- ✅ FREE (unlimited bandwidth)
- ✅ Fast global CDN
- ✅ Automatic version management
- ✅ Download analytics

---

### Option 2: CloudFlare R2 (If You Want Custom Domain)

1. **Upload to R2:**
```bash
# Install Wrangler
npm install -g wrangler

# Login to CloudFlare
wrangler login

# Create R2 bucket
wrangler r2 bucket create thalamus-vm-downloads

# Upload files
wrangler r2 object put thalamus-vm-downloads/thalamus-vm-windows.exe --file builds/thalamus-vm-windows.exe
wrangler r2 object put thalamus-vm-downloads/thalamus-vm-macos --file builds/thalamus-vm-macos
wrangler r2 object put thalamus-vm-downloads/thalamus-vm-linux --file builds/thalamus-vm-linux
```

2. **Make Public:**
- Go to CloudFlare dashboard
- R2 → Your bucket → Settings
- Enable "Public Access"
- Copy public URL

3. **Custom Domain (Optional):**
- Add CNAME: `downloads.thalamus.dev` → Your R2 bucket URL
- Download URLs: `https://downloads.thalamus.dev/thalamus-vm-windows.exe`

**Benefits:**
- ✅ FREE (10GB/month included)
- ✅ Custom domain
- ✅ Fast global CDN

---

### Option 3: Direct File Server (Simple but Limited)

1. **Host on Your Server:**
```bash
# Upload to your server
scp builds/* user@yourserver.com:/var/www/downloads/

# Make files downloadable
chmod 644 /var/www/downloads/*
```

2. **Nginx Config:**
```nginx
location /downloads/ {
    alias /var/www/downloads/;
    autoindex on;
    add_header Content-Disposition 'attachment';
}
```

3. **Download URLs:**
```
https://yourserver.com/downloads/thalamus-vm-windows.exe
https://yourserver.com/downloads/thalamus-vm-macos
https://yourserver.com/downloads/thalamus-vm-linux
```

**Cons:**
- ❌ Bandwidth costs
- ❌ Slower (no CDN)
- ❌ Manual management

---

## Update Download URLs in Code

After hosting, update `src/lib/vmLauncher.ts`:

```typescript
getDownloadUrl(): string {
  const platform = navigator.platform.toLowerCase();
  const baseUrl = "https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download";
  
  if (platform.includes("win")) {
    return `${baseUrl}/thalamus-vm-windows.exe`;
  } else if (platform.includes("mac")) {
    return `${baseUrl}/thalamus-vm-macos`;
  } else {
    return `${baseUrl}/thalamus-vm-linux`;
  }
}
```

---

## For Users (Web App Auto-Download)

When you click "Boot VM" in the web app:

1. **Web checks:** Is bridge running? (`ws://localhost:5900`)
2. **If NO:** Shows download dialog with big button
3. **User clicks:** "Download for Windows/Mac/Linux"
4. **Browser downloads:** Single `.exe` file
5. **User runs:** Double-click (Windows) or `chmod +x && ./file` (Mac/Linux)
6. **Done!** Bridge starts automatically

**From user perspective:**
- Click "Boot VM"
- Download file (if first time)
- Run file (one time only)
- All future VM boots just work

---

## Current Build Status

Building executables now... This takes ~2-5 minutes.

Check build progress:
```bash
ls -lh qemu-bridge/builds/
```

When done, you'll see:
```
-rw-r--r-- 1 user user 50M thalamus-vm-windows.exe
-rw-r--r-- 1 user user 50M thalamus-vm-macos
-rw-r--r-- 1 user user 45M thalamus-vm-linux
```

---

## Security Note

**Windows SmartScreen Warning:**

Users will see: "Windows protected your PC"

**Fix:**
1. Click "More info"
2. Click "Run anyway"

**Why:** Executable not code-signed (certificate costs $300/year)

**Long-term solution:** Buy code signing certificate from DigiCert/GlobalSign

---

## Recommendation: Use GitHub Releases

**Best choice because:**
- ✅ FREE
- ✅ Fast (GitHub CDN)
- ✅ Trusted domain (github.com)
- ✅ Automatic versioning
- ✅ Download analytics
- ✅ No maintenance

Just create a GitHub repo, upload executables, done!
