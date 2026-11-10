# GitHub Actions self-hosted runner chạy trong Docker (máy Windows/Mac của mình, Railway…): job chạy ở đây không tính
# phút Actions của repo private. Image runner chính chủ của GitHub (Ubuntu, user `runner` có sudo không mật khẩu).
FROM ghcr.io/actions/actions-runner:2.338.2

USER root
# Máy GitHub có sẵn mấy thứ này mà image runner thì không: gh (pipeline dùng để tạo release, tải video lên kho)
# và ffmpeg (cài sẵn ở đây thì khỏi apt-get mỗi lượt chạy).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq git xz-utils fontconfig ca-certificates gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY start.sh /home/runner/start.sh
RUN chmod +x /home/runner/start.sh && chown runner:runner /home/runner/start.sh

USER runner
WORKDIR /home/runner
ENTRYPOINT ["/home/runner/start.sh"]
