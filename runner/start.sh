#!/usr/bin/env bash
# Khởi động runner: xin token đăng ký mới (token chỉ hạn 1 giờ nên mỗi lần khởi động phải xin lại),
# đăng ký RUNNERS runner (mặc định 2: daily và render chạy song song), dừng thì gỡ đăng ký.
#
# Biến môi trường (đặt trong Railway → service → Variables):
#   GH_PAT   (bắt buộc) fine-grained token, chỉ repo này, quyền "Administration: Read and write"
#   REPO     mặc định trongbao123/ma-ton-studio
#   LABEL    mặc định railway  → biến repo RUNNER_LABEL = railway để workflow chạy ở đây
#   RUNNERS  mặc định 2
#   NAME     tiền tố tên runner, mỗi máy một tên (vd win, mac) — trùng tên thì máy sau đè đăng ký máy trước
set -euo pipefail
: "${GH_PAT:?Thiếu GH_PAT}"
REPO="${REPO:-trongbao123/ma-ton-studio}"
LABEL="${LABEL:-railway}"
N="${RUNNERS:-2}"
NAME="${NAME:-$LABEL}"
HOME_DIR=/home/runner

token() {
  curl -fsSL -X POST -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/actions/runners/$1" | jq -r .token
}

pids=()
cleanup() {
  echo "▶ Dừng: gỡ đăng ký runner"
  local t
  t=$(token remove-token || true)
  for i in $(seq 1 "$N"); do
    (cd "$HOME_DIR/r$i" && ./config.sh remove --token "$t" >/dev/null 2>&1) || true
  done
  kill "${pids[@]}" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

reg=$(token registration-token)
[ -n "$reg" ] && [ "$reg" != "null" ] || { echo "Không xin được token đăng ký — kiểm tra GH_PAT (quyền Administration: Read and write)"; exit 1; }

for i in $(seq 1 "$N"); do
  d="$HOME_DIR/r$i"
  if [ ! -x "$d/run.sh" ]; then
    mkdir -p "$d"
    # Hard link file runner từ bản gốc: mỗi runner một thư mục riêng mà không tốn thêm dung lượng.
    cp -al "$HOME_DIR"/bin "$HOME_DIR"/externals "$d"/
    # config.sh, run.sh, env.sh, run-helper.sh.template, safe_sleep.sh… (mọi file ở gốc, trừ script này).
    find "$HOME_DIR" -maxdepth 1 -type f ! -name start.sh ! -name '.*' -exec cp {} "$d"/ \;
  fi
  (cd "$d" && ./config.sh --unattended --replace --url "https://github.com/$REPO" --token "$reg" \
    --name "$NAME-$i" --labels "$LABEL" --work _work >/dev/null)
  echo "✔ Runner $NAME-$i (nhãn $LABEL) đã đăng ký"
  (cd "$d" && ./run.sh) &
  pids+=($!)
done

# Một runner chết thì thoát để Railway khởi động lại container (đăng ký lại từ đầu).
wait -n "${pids[@]}"
echo "⚠ Một runner đã dừng — khởi động lại container"
cleanup
