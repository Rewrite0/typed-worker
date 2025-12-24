# 使用 Playwright 官方镜像，已包含所有浏览器和依赖
FROM mcr.microsoft.com/playwright:v1.57.0-noble

# 安装 pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 运行测试
CMD ["pnpm", "test"]
