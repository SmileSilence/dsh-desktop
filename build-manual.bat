@echo off
echo ========================================
echo Manual Build DSH Desktop
echo ========================================

:: Create build directory
if exist "build" rmdir /s /q "build"
mkdir build

:: Copy Electron files
echo Copying Electron files...
xcopy "node_modules\electron\dist\*" "build\" /E /I /Y

:: Copy application files
echo Copying application files...
mkdir "build\resources\app"
copy main.js "build\resources\app\"
copy preload.js "build\resources\app\"
copy package.json "build\resources\app\"

:: Copy assets
echo Copying assets...
xcopy assets "build\resources\app\assets\" /E /I /Y

:: Create startup script
echo Creating startup script...
(
echo @echo off
echo echo Starting DeepSeek Harness Desktop...
echo cd /d "%%~dp0"
echo electron.exe .
echo pause
) > build\start.bat

echo.
echo Build completed successfully!
echo.
echo Directory structure:
tree build /F
echo.
echo To run: Double-click build\start.bat
echo.
pause
