FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Ảnh dựng chỉ cần Vite, không cài Electron để tránh tải cây phụ thuộc quá lớn.
RUN npm install --omit=dev && \
    npm install --no-save vite@^6.2.0 @vitejs/plugin-react@^5.0.0 typescript@~5.8.2 @types/node@^22.14.0

COPY . .

RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Sao chép sản phẩm build của Vite vào thư mục phục vụ của Nginx.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
