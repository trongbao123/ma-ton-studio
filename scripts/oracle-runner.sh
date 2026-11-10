#!/usr/bin/env bash
# Cài GitHub Actions self-hosted runner trên máy ảo Oracle Cloud Always Free (Ubuntu 22.04/24.04, ARM64 hoặc x64).
# Job chạy ở đây không tính phút Actions của repo private. Sau khi cài: GitHub repo → Settings → Secrets and variables
# → Actions → tab Variables → thêm RUNNER_LABEL = oracle (xoá biến này là quay về máy GitHub như cũ).
#
# Dùng (token lấy ở Settings → Actions → Runners → New self-hosted runner, hạn 1 giờ):
#   TOKEN=<registration token> bash oracle-runner.sh [số runner, mặc định 2]
set -euo pipefail
: "${TOKEN:?Thiếu TOKEN (registration token của repo)}"
REPO="${REPO:-trongbao123/ma-ton-studio}"
COUNT="${1:-2}"
VERSION="${RUNNER_VERSION:-2.338.2}"

case "$(uname -m)" in
  aarch64 | arm64) A=arm64 ;;
  x86_64) A=x64 ;;
  *) echo "Không hỗ trợ kiến trúc $(uname -m)"; exit 1 ;;
esac

echo "▶ Cài gói hệ thống"
sudo apt-get update -qq
sudo apt-get install -y -qq curl git xz-utils tar jq build-essential fontconfig ca-certificates

# Swap 4 GB phòng lúc dựng video + chạy CLI AI cùng lúc.
if ! swapon --show | grep -q /swapfile; then
  echo "▶ Tạo swap 4 GB"
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap -q /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# User riêng cho runner; được sudo không mật khẩu (action setup-ffmpeg có thể cần apt-get).
id gha >/dev/null 2>&1 || sudo useradd -m -s /bin/bash gha
echo 'gha ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/gha >/dev/null
sudo chmod 440 /etc/sudoers.d/gha

for i in $(seq 1 "$COUNT"); do
  dir="/home/gha/runner-$i"
  echo "▶ Runner oracle-$i ($A) → $dir"
  sudo -u gha mkdir -p "$dir"
  sudo -u gha bash -c "cd '$dir' && curl -fsSL 'https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$A-$VERSION.tar.gz' | tar xz"
  sudo -u gha bash -c "cd '$dir' && ./config.sh --unattended --replace --url 'https://github.com/$REPO' --token '$TOKEN' --name 'oracle-$i' --labels oracle"
  (cd "$dir" && sudo ./svc.sh install gha >/dev/null && sudo ./svc.sh start >/dev/null)
done

echo "✔ Xong. Kiểm tra: GitHub repo → Settings → Actions → Runners (oracle-1..$COUNT phải 'Idle')."
echo "  Rồi đặt biến repo RUNNER_LABEL = oracle để các workflow chạy ở đây."
