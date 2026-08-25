@echo off
setlocal EnableDelayedExpansion

rem Forces Python's default text I/O to UTF-8 regardless of the system's
rem locale/codepage. Without this, some setup.py scripts (e.g. groundingdino-py,
rem pulled in by ComfyUI-RMBG) read a non-ASCII file with the OS default codepage
rem (cp949 on Korean Windows) and crash with UnicodeDecodeError on the first
rem non-ASCII byte they hit.
set "PYTHONUTF8=1"

echo ========================================================================
echo   AI ONE STUDIO - ComfyUI Backend Dependency Installer
echo   Installs ComfyUI-TJ_NODE_STUDIO_ONE and every custom node / Python
echo   package the 6 tools (MiniMax H3, Krea2, Z-Image, Flux2 Klein,
echo   Qwen Image 2511, SDXL) need, plus ComfyUI-Crystools (powers the
echo   live CPU/RAM/GPU/VRAM/temp monitor in the site's top bar).
echo   Already-installed nodes are skipped.
echo ========================================================================
echo.

rem ── ComfyUI path ─────────────────────────────────────────────────────────
set "COMFY_DIR="
:ASK_PATH
set /p "COMFY_DIR=Enter the path to your existing ComfyUI folder (the one that contains custom_nodes): "
if "%COMFY_DIR%"=="" (
    echo [ERROR] Please enter a path.
    goto ASK_PATH
)
rem Strip a trailing backslash
if "%COMFY_DIR:~-1%"=="\" set "COMFY_DIR=%COMFY_DIR:~0,-1%"

if not exist "%COMFY_DIR%\custom_nodes" (
    echo [ERROR] Could not find "%COMFY_DIR%\custom_nodes".
    echo         Make sure you entered the ComfyUI root folder, e.g. C:\ComfyUI
    echo         or ...\ComfyUI_windows_portable\ComfyUI
    echo.
    goto ASK_PATH
)
echo [OK] ComfyUI: %COMFY_DIR%
echo.

rem ── git check ────────────────────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git is not installed. Install it from https://git-scm.com/downloads and run this again.
    pause
    exit /b 1
)

rem ── Python path detection ────────────────────────────────────────────────
rem Supports both ComfyUI portable (python_embeded one level above ComfyUI)
rem and venv installs (either inside ComfyUI or one level above).
set "PYTHON="
if exist "%COMFY_DIR%\..\python_embeded\python.exe" (
    set "PYTHON=%COMFY_DIR%\..\python_embeded\python.exe"
) else if exist "%COMFY_DIR%\venv\Scripts\python.exe" (
    set "PYTHON=%COMFY_DIR%\venv\Scripts\python.exe"
) else if exist "%COMFY_DIR%\..\venv\Scripts\python.exe" (
    set "PYTHON=%COMFY_DIR%\..\venv\Scripts\python.exe"
) else (
    where python >nul 2>&1 && set "PYTHON=python"
)

if "%PYTHON%"=="" (
    echo [WARN] Could not find Python - pip install steps will be skipped.
    echo        Run this script from the Python environment ComfyUI uses.
) else (
    echo [INFO] Python: %PYTHON%
)
echo.

if "%PYTHON%"=="" goto SKIP_PIP_UPGRADE
echo [PIP] Upgrading pip, setuptools, and wheel to the latest versions...
"%PYTHON%" -m pip install --upgrade pip --quiet
rem --force-reinstall matters here: recent pip versions can pre-seed a
rem "wheel_stub" placeholder package that satisfies "wheel is installed"
rem checks but has no real build backend, breaking every source package
rem that needs one ("Cannot import 'wheel_stub.buildapi'"). A plain
rem --upgrade doesn't necessarily replace an already-"satisfied" stub -
rem force-reinstall does.
"%PYTHON%" -m pip install --upgrade --force-reinstall setuptools wheel --quiet
echo.
:SKIP_PIP_UPGRADE

cd /d "%COMFY_DIR%\custom_nodes"

rem ── Main package: ComfyUI-TJ_NODE_STUDIO_ONE ────────────────────────────
echo ========================================================================
echo  [MAIN] ComfyUI-TJ_NODE_STUDIO_ONE
echo ========================================================================
if exist "ComfyUI-TJ_NODE_STUDIO_ONE" goto MAIN_SKIP
echo [INSTALL] Cloning...
git clone https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE.git
if errorlevel 1 goto MAIN_CLONE_FAIL
echo [OK] Cloned.
goto MAIN_PIP
:MAIN_CLONE_FAIL
echo [ERROR] git clone failed. Check your internet connection.
goto MAIN_PIP
:MAIN_SKIP
echo [UPDATE] Already installed - checking for updates...
pushd "ComfyUI-TJ_NODE_STUDIO_ONE"
git pull --ff-only
popd
:MAIN_PIP
if "%PYTHON%"=="" goto MAIN_PIP_DONE
if not exist "ComfyUI-TJ_NODE_STUDIO_ONE\requirements.txt" goto MAIN_PIP_DONE
echo [PIP] Installing ComfyUI-TJ_NODE_STUDIO_ONE requirements...
"%PYTHON%" -m pip install -r "ComfyUI-TJ_NODE_STUDIO_ONE\requirements.txt" --quiet
if not errorlevel 1 goto MAIN_PIP_OK
echo [PIP] Retrying with --no-build-isolation...
"%PYTHON%" -m pip install -r "ComfyUI-TJ_NODE_STUDIO_ONE\requirements.txt" --no-build-isolation --quiet
if errorlevel 1 goto MAIN_PIP_WARN
:MAIN_PIP_OK
echo [PIP] Done.
goto MAIN_PIP_DONE
:MAIN_PIP_WARN
echo [WARN] Some packages failed to install - check manually.
:MAIN_PIP_DONE
echo.

rem ── Dependency custom node list ──────────────────────────────────────────
rem Based on ComfyUI-TJ_NODE_STUDIO_ONE/install_requirements.bat - everything
rem the 6 image tools and the MiniMax H3 video node need. Crystools (monitor
rem widget) isn't in that list; it's only needed here.
set REPOS[0]=https://github.com/ltdrdata/ComfyUI-Impact-Pack
set REPOS[1]=https://github.com/ltdrdata/ComfyUI-Impact-Subpack
set REPOS[2]=https://github.com/kijai/ComfyUI-KJNodes
set REPOS[3]=https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler
set REPOS[4]=https://github.com/cubiq/ComfyUI_FaceAnalysis
set REPOS[5]=https://github.com/1038lab/ComfyUI-RMBG
set REPOS[6]=https://github.com/Fannovel16/comfyui_controlnet_aux
set REPOS[7]=https://github.com/city96/ComfyUI-GGUF
set REPOS[8]=https://github.com/facok/comfyui-krea2-controlnet
set REPOS[9]=https://github.com/lbouaraba/comfyui-krea2edit
set REPOS[10]=https://github.com/Nynxz/ComfyUI-NK2E
set REPOS[11]=https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache
set REPOS[12]=https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo
set REPOS[13]=https://github.com/kijai/ComfyUI-SolAttn_triton
set REPOS[14]=https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI
set REPOS[15]=https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
set REPOS[16]=https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3
set REPOS[17]=https://github.com/crystian/ComfyUI-Crystools
set REPOS[18]=https://github.com/duckyshell/ComfyUI-MiniMaxH3-FirstBlockCache
set REPOS[19]=https://github.com/designloves2/ComfyUI-TJ_NODE
set REPOS[20]=https://github.com/PlagueKind/ComfyUI-PlagueKind-Nodes

set COUNT=21

rem The whole loop body lives in a called subroutine instead of a nested
rem parenthesized for/if block, so "do" only ever runs a single command.
for /L %%i in (0,1,20) do call :InstallRepo %%i
goto AFTER_REPOS

:InstallRepo
set "IDX=%~1"
set "URL=!REPOS[%IDX%]!"
for %%F in (!URL!) do set "FOLDER=%%~nxF"

echo ------------------------------------------------------------------------
echo [%IDX%/20] !FOLDER!
echo         !URL!

if exist "!FOLDER!" goto REPO_SKIP
echo [INSTALL] Cloning...
git clone "!URL!" "!FOLDER!"
if errorlevel 1 goto REPO_CLONE_FAIL
echo [OK] Cloned.
goto REPO_PIP
:REPO_CLONE_FAIL
echo [ERROR] git clone failed. Check your internet connection.
goto REPO_DONE
:REPO_SKIP
rem Folder already exists - could be a clean previous install, an existing
rem repo that just needs updating, or one that got cloned but whose pip
rem install failed/never ran (e.g. an earlier run errored out partway
rem through). Pull for updates (--ff-only so a repo with local changes is
rem left alone rather than risking a merge conflict), then always retry the
rem requirements install below - pip install is idempotent, so it's cheap/
rem instant when everything's already satisfied.
echo [UPDATE] Already cloned - checking for updates...
pushd "!FOLDER!"
git pull --ff-only
popd
goto REPO_PIP

:REPO_PIP
if "%PYTHON%"=="" goto REPO_DONE
if not exist "!FOLDER!\requirements.txt" goto REPO_DONE
echo [PIP] Installing requirements...

rem dlib needs cmake/a C++ compiler to build from source, which is the most
rem common failure point - filter it out and install the prebuilt wheel
rem (dlib-bin) instead.
set "REQ_FILE=!FOLDER!\requirements.txt"
set "REQ_FILTERED=%TEMP%\aios_req_!FOLDER!.txt"
findstr /v /i "^dlib" "!REQ_FILE!" > "!REQ_FILTERED!"

"%PYTHON%" -m pip install -r "!REQ_FILTERED!" --quiet
if not errorlevel 1 goto REPO_PIP_OK
rem Some packages fail inside pip's isolated build env specifically with
rem "Cannot import 'wheel_stub.buildapi'" - that env doesn't inherit the
rem global wheel/setuptools installed above. Retry using the global
rem environment's build tools instead of a fresh isolated one.
echo [PIP] Retrying with --no-build-isolation...
"%PYTHON%" -m pip install -r "!REQ_FILTERED!" --no-build-isolation --quiet
if errorlevel 1 goto REPO_PIP_WARN
:REPO_PIP_OK
echo [PIP] Done.
goto REPO_DLIB_CHECK
:REPO_PIP_WARN
echo [WARN] pip install failed - check manually.

:REPO_DLIB_CHECK
findstr /i /r "^dlib" "!REQ_FILE!" >nul
if errorlevel 1 goto REPO_CLEANUP
echo [PIP] Installing dlib (prebuilt wheel)...
"%PYTHON%" -m pip install dlib-bin --quiet
if errorlevel 1 goto REPO_DLIB_WARN
echo [PIP] dlib installed.
goto REPO_CLEANUP
:REPO_DLIB_WARN
echo [WARN] dlib install skipped - face-recognition features may be limited.

:REPO_CLEANUP
del "!REQ_FILTERED!" >nul 2>&1

:REPO_DONE
echo.
exit /b 0

:AFTER_REPOS
echo ========================================================================
echo  Done! Restart ComfyUI to load every node.
echo ========================================================================
echo.
echo  [Model files are NOT installed by this script - download them yourself]
echo  [into models\. See ComfyUI-TJ_NODE_STUDIO_ONE's README.md and the]
echo  [install_requirements.bat instructions for the full list.]
echo  [The top bar's Restart button needs ComfyUI-Manager installed - most]
echo  [installs already have it, and this script does not install it.]
echo ========================================================================
pause
