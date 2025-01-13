# Use CUDA 12.1 or 12.2 as the base image
FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu20.04
# OR
# FROM nvidia/cuda:12.2.0-cudnn8-devel-ubuntu20.04

# Set Nvidia driver capabilities to include all necessary libraries
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    yasm \
    nasm \
    libx264-dev \
    libx265-dev \
    libnuma-dev \
    libvpx-dev \
    libfdk-aac-dev \
    libmp3lame-dev \
    libopus-dev \
    libass-dev \
    libfreetype6-dev \
    libfontconfig1-dev \
    git \
    wget \
    gnupg2 \
    ca-certificates \
    procps \
    libxshmfence1 \
    xdg-utils \
    curl \
    pulseaudio \
    xvfb \
    libpulse-dev \
    libxcb1-dev \
    libxcb-shm0-dev \
    libxcb-xfixes0-dev \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js and npm
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Install ffnvcodec
RUN git clone https://git.videolan.org/git/ffmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make && \
    make install

# Clone and build FFmpeg with Nvidia CUDA support
RUN git clone https://git.ffmpeg.org/ffmpeg.git ffmpeg
WORKDIR /ffmpeg
RUN ./configure \
    --prefix=/usr/local \
    --enable-cuda-nvcc \
    --enable-cuvid \
    --enable-nvenc \
    --enable-libnpp \
    --extra-cflags=-I/usr/local/cuda/include \
    --extra-ldflags=-L/usr/local/cuda/lib64 \
    --enable-gpl \
    --enable-libx264 \
    --enable-libx265 \
    --enable-libvpx \
    --enable-libfdk-aac \
    --enable-libmp3lame \
    --enable-libopus \
    --enable-libass \
    --enable-libfreetype \
    --enable-libfontconfig \
    --enable-nonfree \
    --enable-libpulse \
    --enable-libxcb \
    && make -j$(nproc) && make install

# Create the app directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json (if available) and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Now copy the rest of the application code (including index.js)
COPY . .

# Expose port 8080 to the outside once the container has launched
EXPOSE 8080

# Run the Node.js application
CMD ["node", "index.js"]
