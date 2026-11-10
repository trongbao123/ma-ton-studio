# GitHub Actions self-hosted runner chạy trên Railway (hoặc bất kỳ máy Docker nào): job chạy ở đây không tính phút
# Actions của repo private. Image runner chính chủ của GitHub (Ubuntu, user `runner` có sudo không mật khẩu).
FROM ghcr.io/actions/actions-runner:2.338.2

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq git xz-utils fontconfig ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY start.sh /home/runner/start.sh
RUN chmod +x /home/runner/start.sh && chown runner:runner /home/runner/start.sh

USER runner
WORKDIR /home/runner
ENTRYPOINT ["/home/runner/start.sh"]
