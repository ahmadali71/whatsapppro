# =============================================
# Stage 1: Base
# =============================================
FROM node:20-alpine AS base
WORKDIR /app

# =============================================
# Stage 2: Development
# =============================================
FROM base AS development
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# =============================================
# Stage 3: Builder
# =============================================
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# =============================================
# Stage 4: Production
# =============================================
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
