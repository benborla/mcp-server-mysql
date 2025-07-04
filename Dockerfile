# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
# Use a Node.js Alpine image as the base
FROM node:22-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy the package.json and pnpm-lock.yaml if present
COPY package.json pnpm-lock.yaml* /app/

# Install the dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy the rest of the application code
COPY . /app

# Build the application
RUN pnpm run build

# Use a new, clean image for the release
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy the built files from the builder
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/pnpm-lock.yaml* /app/

# Set environment variables
ENV MYSQL_HOST=127.0.0.1
ENV MYSQL_PORT=3306
ENV MYSQL_USER=root
ENV MYSQL_PASS=
ENV MYSQL_DB=db_name
ENV ALLOW_INSERT_OPERATION=true
ENV ALLOW_UPDATE_OPERATION=true
ENV ALLOW_DELETE_OPERATION=false

# Install production dependencies only
# Add --no-optional flag to skip lifecycle scripts like prepare
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# # Expose any ports if necessary (e.g., 8080)
# EXPOSE 8080

# Run the server
ENTRYPOINT ["node", "dist/index.js"]
