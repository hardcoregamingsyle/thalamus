# How to Deploy VM Launcher (3 Steps)

## The Problem with /public Folder

**Why we can't put 50MB .exe in /public:**
- ❌ Too large for git (max recommended: 100MB total repo)
- ❌ Slows down every git clone/pull
- ❌ Build/deploy becomes slow
- ❌ Can't version control binaries properly

**Solution:** Host executables separately on GitHub Releases (FREE + unlimited bandwidth)

---

## Step 1: Build Executables (One Time)

```bash
cd qemu-bridge
./QUICK_DEPLOY.sh
```

This creates:
- `builds/thalamus-vm-windows.exe` (50MB)
- `builds/thalamus-vm-macos` (50MB)
- `builds/thalamus-vm-linux` (45MB)

**Time:** 5-10 minutes (downloads Node.js binaries first time)

---

## Step 2: Upload to GitHub Releases

### Option A: Using GitHub CLI (Easiest)

```bash
# Create repo if needed
gh repo create thalamus-vm --public

# Create release with files
gh release create v1.0.0 \
  builds/thalamus-vm-windows.exe \
  builds/thalamus-vm-macos \
  builds/thalamus-vm-linux \
  --title "Thalamus VM Launcher v1.0.0" \
  --notes "One-click VM launcher. Download, run, done!"
```

### Option B: Using GitHub Web UI

1. Go to your GitHub repo
2. Click "Releases" → "Create a new release"
3. Tag: `v1.0.0`
4. Title: "Thalamus VM Launcher v1.0.0"
5. Upload the 3 files from `builds/` folder
6. Click "Publish release"

**Done!** Your files are now hosted at:
```
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-windows.exe
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-macos
https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download/thalamus-vm-linux
```

---

## Step 3: Update Download URLs

Edit `src/lib/vmLauncher.ts`:

```typescript
getDownloadUrl(): string {
  const platform = navigator.platform.toLowerCase();
  const githubBase = "https://github.com/YOUR_USERNAME/thalamus-vm/releases/latest/download";
  //                                      ^^^^^^^^^^^^^ CHANGE THIS
  
  if (platform.includes("win")) {
    return `${githubBase}/thalamus-vm-windows.exe`;
  } else if (platform.includes("mac")) {
    return `${githubBase}/thalamus-vm-macos`;
  } else {
    return `${githubBase}/thalamus-vm-linux`;
  }
}
```

Replace `YOUR_USERNAME` with your actual GitHub username.

**Deploy the fix:**
```bash
npm run deploy
```

---

## How It Works for Users

1. **User clicks "Boot VM"** in your web app
2. **Web checks:** `ws://localhost:5900` (is bridge running?)
3. **If NO:** Shows dialog with download button
4. **User clicks download** → Browser downloads .exe from GitHub
5. **User runs .exe** → Bridge starts
6. **Web auto-detects** → Dialog closes
7. **User clicks "Boot VM"** again → Works! VM boots

**From user perspective:** Download once, works forever

---

## Alternative: Use Your Own Server

If you want to host on your own server:

```bash
# Upload files
scp builds/* yourserver:/var/www/downloads/

# Update URLs in vmLauncher.ts
const cdnBase = "https://yourserver.com/downloads";
```

**Cons:**
- Costs money (bandwidth)
- Slower (no CDN)
- More work to maintain

**GitHub Releases is better:** FREE + CDN + automatic

---

## FAQ

**Q: Can I put it in Convex file storage?**
A: No, Convex file storage is for user uploads, not for hosting app binaries.

**Q: Can I use CloudFlare Pages?**
A: No, Pages has 25MB file size limit.

**Q: Can I use Netlify?**
A: No, similar limits and not designed for this.

**Q: What about npm package?**
A: Users would still need Node.js installed, defeating the purpose.

**Q: Why not ship with Electron?**
A: Electron app would be 200MB+ (vs 50MB standalone). Plus can't run in browser.

---

## Summary

| Method | Cost | Speed | Setup | Best For |
|--------|------|-------|-------|----------|
| **GitHub Releases** | FREE | Fast | 2 commands | ✅ Everyone |
| CloudFlare R2 | FREE* | Fast | 10 min | Custom domain |
| Your server | $$$ | Slow | Complex | Large scale |
| /public folder | N/A | N/A | ❌ Won't work | N/A |

**Recommendation:** Use GitHub Releases (it's free, fast, and simple)

---

## Current Status

The build is running in background. To check:
```bash
ls -lh qemu-bridge/builds/
```

When you see 3 files (~145MB total), you're ready to upload!
