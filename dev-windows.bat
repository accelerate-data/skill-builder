@echo off
SET PATH=C:\msys64\mingw64\bin;C:\Users\ADMIN\.cargo\bin;%PATH%
SET RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
cd /d C:\Users\ADMIN\github\skill-builder\app
npm run dev
