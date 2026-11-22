# Kernel Kaggle: cài Blender rồi render cảnh địa hình 3D bằng GPU (OptiX/CUDA của T4).
# Dataset đính kèm chứa: config.json, texture.png, BeVietnamPro-Bold.ttf, scene.py
import glob, os, shutil, subprocess, sys, urllib.request

BLENDER_URL = "https://download.blender.org/release/Blender4.2/blender-4.2.1-linux-x64.tar.xz"
WORK = "/kaggle/working"
OUT_FRAMES = os.path.join(WORK, "frames")

src = next(iter(glob.glob("/kaggle/input/*")), None)
if not src:
    sys.exit("Không thấy dataset đầu vào")
for name in ("config.json", "texture.png", "BeVietnamPro-Bold.ttf", "scene.py"):
    shutil.copy(os.path.join(src, name), os.path.join(WORK, name))
os.makedirs(OUT_FRAMES, exist_ok=True)

archive = "/tmp/blender.tar.xz"
if not os.path.exists("/tmp/blender/blender"):
    urllib.request.urlretrieve(BLENDER_URL, archive)
    os.makedirs("/tmp/blender", exist_ok=True)
    subprocess.run(["tar", "-xJf", archive, "-C", "/tmp/blender", "--strip-components=1"], check=True)

# --cycles-device trên dòng lệnh: chọn GPU trong script không có tác dụng ở chế độ chạy nền.
proc = subprocess.run(
    ["/tmp/blender/blender", "-b", "-P", os.path.join(WORK, "scene.py"), "--cycles-device", "OPTIX", "--", WORK],
    capture_output=True, text=True,
)
print(proc.stdout[-4000:])
print(proc.stderr[-4000:], file=sys.stderr)
frames = sorted(glob.glob(os.path.join(OUT_FRAMES, "*.png")))
print(f"RENDER XONG: {len(frames)} khung")
if not frames:
    sys.exit("Không có khung nào được render")
