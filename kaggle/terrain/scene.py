# Cảnh địa hình 3D cho kênh lịch sử: mặt đất theo độ cao thật (Terrarium), texture bản đồ, mũi tên hành quân mọc dần,
# địa danh dựng đứng có viền, điểm nổ, máy quay bay. Đọc config.json (do scene-terrain.ts ghi), xuất PNG vào frames/.
# Chạy (Kaggle): blender -b -P scene.py --cycles-device OPTIX -- <thư mục làm việc>
# Đặt --cycles-device TRÊN DÒNG LỆNH: chọn thiết bị trong script không có tác dụng ở chế độ chạy nền.
import json, math, os, sys, urllib.request
import bpy, numpy as np

ROOT = sys.argv[sys.argv.index("--") + 1]
cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
B = cfg["bbox"]; COS = math.cos(((B["s"] + B["n"]) / 2) * math.pi / 180)
LON0 = (B["w"] + B["e"]) / 2; LAT0 = (B["s"] + B["n"]) / 2
K = 100.0          # đơn vị Blender / 1 độ vĩ
VEXAG = 4.0        # phóng đại chiều cao cho núi rõ
FOG_START_FACTOR = 0.55   # sương mờ xa: che mép bản đồ, tạo chiều sâu
Z_PER_M = K / 111000.0 * VEXAG
FONT = os.path.join(ROOT, "BeVietnamPro-Bold.ttf")
FPS = int(cfg.get("fps", 25)); FRAMES = max(1, int(round(cfg.get("seconds", 9) * FPS)))
ZOOM = 10

def xy(lon, lat):
    return ((lon - LON0) * COS * K, (lat - LAT0) * K)

# ── Độ cao: ô Terrarium (độ cao = R*256 + G + B/256 - 32768), chiếu Mercator.
def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

tiles = {}
def tile(tx, ty):
    key = (tx, ty)
    if key in tiles: return tiles[key]
    f = os.path.join(ROOT, "tiles", f"{ZOOM}_{tx}_{ty}.png")
    if not os.path.exists(f):
        os.makedirs(os.path.dirname(f), exist_ok=True)
        req = urllib.request.Request(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{tx}/{ty}.png", headers={"User-Agent": "ma-ton-studio/1.0"})
        open(f, "wb").write(urllib.request.urlopen(req).read())
    img = bpy.data.images.load(f)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1] * 255.0
    h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    tiles[key] = h
    return h

def height(lon, lat):
    x, y = tile_xy(lon, lat, ZOOM)
    tx, ty = int(x), int(y)
    h = tile(tx, ty)
    px = min(255, int((x - tx) * 256)); py = min(255, int((y - ty) * 256))
    return max(0.0, float(h[py, px]))

# ── Dọn cảnh mặc định
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── Mặt địa hình
# Mặt đất phủ rộng hơn khung 60% để máy quay không bao giờ thấy mép.
MARGIN = 0.6
B = {"w": B["w"] - (B["e"] - B["w"]) * MARGIN / 2, "e": B["e"] + (B["e"] - B["w"]) * MARGIN / 2,
     "s": B["s"] - (B["n"] - B["s"]) * MARGIN / 2, "n": B["n"] + (B["n"] - B["s"]) * MARGIN / 2}
NX, NY = 420, 486
verts, faces, uvs = [], [], []
for j in range(NY):
    lat = B["s"] + (B["n"] - B["s"]) * j / (NY - 1)
    for i in range(NX):
        lon = B["w"] + (B["e"] - B["w"]) * i / (NX - 1)
        x, y = xy(lon, lat)
        verts.append((x, y, height(lon, lat) * Z_PER_M))
for j in range(NY - 1):
    for i in range(NX - 1):
        a = j * NX + i
        faces.append((a, a + 1, a + NX + 1, a + NX))
mesh = bpy.data.meshes.new("terrain"); mesh.from_pydata(verts, [], faces); mesh.update()
uvl = mesh.uv_layers.new(name="UV")
for poly in mesh.polygons:
    for li in poly.loop_indices:
        vi = mesh.loops[li].vertex_index
        i, j = vi % NX, vi // NX
        uvl.data[li].uv = (i / (NX - 1), j / (NY - 1))
for p in mesh.polygons: p.use_smooth = True
terrain = bpy.data.objects.new("terrain", mesh); scene.collection.objects.link(terrain)
mat = bpy.data.materials.new("map"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]; bsdf.inputs["Roughness"].default_value = 0.85
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(os.path.join(ROOT, "texture.png"))
bc = nt.nodes.new("ShaderNodeBrightContrast"); bc.inputs["Bright"].default_value = 0.12; bc.inputs["Contrast"].default_value = 0.15
nt.links.new(tex.outputs["Color"], bc.inputs["Color"]); nt.links.new(bc.outputs["Color"], bsdf.inputs["Base Color"])
terrain.data.materials.append(mat)

def emissive(name, rgb, strength=2.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    n = m.node_tree.nodes; n.clear()
    e = n.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (*rgb, 1); e.inputs["Strength"].default_value = strength
    o = n.new("ShaderNodeOutputMaterial"); m.node_tree.links.new(e.outputs[0], o.inputs[0])
    return m

# ── Tuyến hành quân: ống đỏ mọc dần (bevel_factor_end)
route = cfg["route"]
# Texture chỉ phủ phần khung gốc (không phải phần nới) → UV lệch; chấp nhận: phần nới là nền biển/đất trơn.
pts = [(*xy(p["lon"], p["lat"]), height(p["lon"], p["lat"]) * Z_PER_M + 0.6) for p in route]
curve = bpy.data.curves.new("route", "CURVE"); curve.dimensions = "3D"
sp = curve.splines.new("BEZIER"); sp.bezier_points.add(len(pts) - 1)
for bp, co in zip(sp.bezier_points, pts):
    bp.co = co; bp.handle_left_type = bp.handle_right_type = "AUTO"
curve.bevel_depth = 0.45; curve.bevel_resolution = 4; curve.use_fill_caps = True
route_obj = bpy.data.objects.new("route", curve); scene.collection.objects.link(route_obj)
route_obj.data.materials.append(emissive("red", (0.78, 0.06, 0.03), 1.0))
START, END = 30, 180
curve.bevel_factor_end = 0.0; curve.keyframe_insert("bevel_factor_end", frame=START)
curve.bevel_factor_end = 1.0; curve.keyframe_insert("bevel_factor_end", frame=END)

# Quãng đường tích luỹ → thời điểm mũi tên chạm từng địa danh
seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
total = sum(seg); acc = [0.0]
for s in seg: acc.append(acc[-1] + s / total)
def point_at(f):
    i = max(0, min(len(pts) - 2, next((k for k in range(len(acc) - 1) if acc[k + 1] >= f), len(pts) - 2)))
    k = 0 if acc[i + 1] == acc[i] else (f - acc[i]) / (acc[i + 1] - acc[i])
    return tuple(pts[i][d] + (pts[i + 1][d] - pts[i][d]) * k for d in range(3))

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 32
target = bpy.data.objects.new("target", None); scene.collection.objects.link(target)
tr = cam.constraints.new("TRACK_TO"); tr.target = target; tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"

# ── Địa danh: cột + chữ đứng quay về máy quay; điểm nổ ở trận
font = bpy.data.fonts.load(FONT)
white = emissive("white", (1, 1, 1), 1.0); gold = emissive("gold", (1.0, 0.75, 0.1), 1.2); fire = emissive("fire", (1.0, 0.5, 0.08), 4.0)
for p, at in zip(route, acc):
    x, y, z = (*xy(p["lon"], p["lat"]), height(p["lon"], p["lat"]) * Z_PER_M)
    appear = int(START + (END - START) * at)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=2.2, location=(x, y, z + 1.1)); pin = bpy.context.object; pin.data.materials.append(gold)
    txt = bpy.data.curves.new(p["name"], "FONT"); txt.body = p["name"].upper(); txt.font = font; txt.size = 2.2 if p["name"] != "Thăng Long" else 3.0
    txt.align_x = "CENTER"; txt.extrude = 0.0; txt.offset = 0.0
    t = bpy.data.objects.new(p["name"], txt); t.location = (x, y, z + 3.2); scene.collection.objects.link(t); t.data.materials.append(white)
    t.visible_shadow = False   # chữ đổ bóng xuống đất trông như chữ in đúp
    # viền đen cho chữ: bản sao dày nét (offset) đặt ngay sau chữ trắng
    back = txt.copy(); back.offset = 0.09; back.materials.clear(); back.materials.append(emissive("ink", (0.02, 0.02, 0.02), 1.0))
    tb = bpy.data.objects.new(p["name"] + "_vien", back); tb.parent = t; tb.location = (0, 0, -0.05); scene.collection.objects.link(tb); tb.visible_shadow = False
    c = t.constraints.new("TRACK_TO"); c.target = cam; c.track_axis = "TRACK_Z"; c.up_axis = "UP_Y"
    for o in (pin, t):
        o.scale = (0.001, 0.001, 0.001); o.keyframe_insert("scale", frame=max(1, appear - 6))
        o.scale = (1, 1, 1); o.keyframe_insert("scale", frame=appear + 4)
    if p["battle"]:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(x, y, z + 0.8)); b = bpy.context.object; b.data.materials.append(fire)
        for fr, s in ((appear - 1, 0.001), (appear + 4, 2.6), (appear + 16, 0.001)):
            b.scale = (s, s, s); b.keyframe_insert("scale", frame=fr)

# ── Máy quay: mở cảnh rộng từ trên cao → hạ xuống bay theo đầu mũi tên (mượt, không giật)
def smooth(t): return t * t * (3 - 2 * t)
wide_target = point_at(0.4); wide_cam = (wide_target[0] - 8, wide_target[1] - 52, 42)
for fr in range(1, FRAMES + 1):
    prog = smooth(min(1, max(0, (fr - START) / (END - START))))
    head = point_at(prog)
    follow_cam = (head[0] - 6, head[1] - 26, head[2] + 18)
    blend = smooth(min(1, max(0, (fr - 10) / 50)))   # 10→60: từ cảnh rộng hạ xuống
    cam.location = tuple(wide_cam[d] + (follow_cam[d] - wide_cam[d]) * blend for d in range(3))
    target.location = tuple(wide_target[d] + (head[d] + (0, 6, 0)[d] - wide_target[d]) * blend for d in range(3))
    cam.keyframe_insert("location", frame=fr); target.keyframe_insert("location", frame=fr)

# ── Ánh sáng: mặt trời xiên thấp cho núi đổ bóng rõ; trời xám xanh
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
sun.data.energy = 3.0; sun.rotation_euler = (math.radians(55), math.radians(10), math.radians(-35))
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.045, 0.075, 1); world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
# Sương mờ xa: hộp thể tích bao cảnh, đậm dần theo khoảng cách — che mép bản đồ.
bpy.ops.mesh.primitive_cube_add(size=4000, location=(0, 0, 0)); fog = bpy.context.object
fog_mat = bpy.data.materials.new("fog"); fog_mat.use_nodes = True
fn = fog_mat.node_tree; fn.nodes.clear()
vol = fn.nodes.new("ShaderNodeVolumeScatter"); vol.inputs["Density"].default_value = 0.00035
vol.inputs["Color"].default_value = (0.42, 0.52, 0.60, 1)
out_node = fn.nodes.new("ShaderNodeOutputMaterial"); fn.links.new(vol.outputs[0], out_node.inputs["Volume"])
fog.data.materials.append(fog_mat); fog.visible_shadow = False

# ── Render: Cycles trên GPU (OptiX/CUDA), 1080p
scene.render.engine = "CYCLES"
scene.view_settings.view_transform = "Standard"   # AgX làm phai màu đỏ/vàng của bản đồ phẳng đậm
scene.view_settings.look = "None"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.refresh_devices()   # Blender 5.x: refresh_devices (get_devices không còn)
for d in prefs.devices: d.use = d.type == "OPTIX"
print("THIẾT BỊ RENDER:", [d.name for d in prefs.devices if d.use])
scene.cycles.device = "GPU"; scene.cycles.samples = 24; scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.fps = FPS; scene.frame_start, scene.frame_end = 1, FRAMES
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(ROOT, "frames", "f")
scene.render.use_file_extension = True
scene.render.use_persistent_data = True
print("CẢNH 3D: dựng xong, bắt đầu render", FRAMES, "khung")
bpy.ops.render.render(animation=True)
