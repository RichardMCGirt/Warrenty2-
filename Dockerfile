# Use the latest LTS Node.js image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy app files
COPY . .

# Expose the port your server listens on
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]
