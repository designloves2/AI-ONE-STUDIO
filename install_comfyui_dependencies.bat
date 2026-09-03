@echo off
setlocal EnableDelayedExpansion

rem Absolute path of this script's folder (the AI ONE STUDIO web kit root),
rem captured before any cd. Used to write public\comfy_port.txt below.
set "WEBKIT_DIR=%~dp0"
if "%WEBKIT_DIR:~-1%"=="\" set "WEBKIT_DIR=%WEBKIT_DIR:~0,-1%"

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

rem -- ComfyUI path ---------------------------------------------------------
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

rem -- ComfyUI port --------------------------------------------------------
rem The web app talks to ComfyUI on 127.0.0.1:<port> for local access. Default
rem is 8188, but a machine with several ComfyUI installs may run this one on a
rem different port. Write it to public\comfy_port.txt so the site picks it up
rem with no rebuild (see src/shared/comfyBase.ts). Blank = keep 8188.
set "COMFY_PORT="
set /p "COMFY_PORT=ComfyUI server port [Enter = 8188]: "
if "%COMFY_PORT%"=="" set "COMFY_PORT=8188"
echo %COMFY_PORT%|findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo [WARN] "%COMFY_PORT%" is not a number - leaving public\comfy_port.txt unchanged.
) else (
    if exist "%WEBKIT_DIR%\public" (
        > "%WEBKIT_DIR%\public\comfy_port.txt" echo %COMFY_PORT%
        echo [OK] Wrote %WEBKIT_DIR%\public\comfy_port.txt = %COMFY_PORT%
    ) else (
        echo [WARN] %WEBKIT_DIR%\public not found - run this script from the AI ONE STUDIO
        echo        web kit folder so it can write public\comfy_port.txt.
    )
)
echo.

rem -- git check ------------------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git is not installed. Install it from https://git-scm.com/downloads and run this again.
    pause
    exit /b 1
)

rem -- Python path detection ------------------------------------------------
rem Mirrors ComfyUI-TJ_NODE_STUDIO_ONE\install_requirements.bat (v1.23.3) - same
rem list, same order. A real venv wins over any base interpreter: ComfyUI Desktop
rem runs from <ComfyUI>\.venv (a uv venv whose home points at ..\standalone-env),
rem and that is where its packages must land - installing straight into
rem standalone-env would leave ComfyUI unable to see them, same as system Python.
rem   <ComfyUI>\venv | .venv \Scripts\python.exe   - manual venv / ComfyUI Desktop
rem   <base>\venv | .venv \Scripts\python.exe       - venv beside ComfyUI
rem   <base>\standalone-env\python.exe              - Desktop base interpreter (only if no .venv)
rem   <ComfyUI>\python_embeded\python.exe           - embedded python inside ComfyUI
rem   <base>\python_embeded\python.exe              - portable build (python_embeded beside ComfyUI)
rem <base> = the folder one level above the ComfyUI folder the user entered.
rem Kept as a called subroutine + plain IFs rather than a nested for/if block -
rem same reason the repo loop below is a subroutine.
set "PYTHON="
call :TryPy "%COMFY_DIR%\venv\Scripts\python.exe"
call :TryPy "%COMFY_DIR%\.venv\Scripts\python.exe"
call :TryPy "%COMFY_DIR%\..\venv\Scripts\python.exe"
call :TryPy "%COMFY_DIR%\..\.venv\Scripts\python.exe"
call :TryPy "%COMFY_DIR%\..\standalone-env\python.exe"
call :TryPy "%COMFY_DIR%\python_embeded\python.exe"
call :TryPy "%COMFY_DIR%\..\python_embeded\python.exe"

if not defined PYTHON call :SystemPyPrompt

if not defined PYTHON goto PY_NONE
echo [INFO] Python: %PYTHON%
goto PY_DONE

:PY_NONE
echo [WARN] No usable Python - custom nodes will still be cloned, but the pip
echo        install steps are skipped. Re-run this from, or point it at, the
echo        Python environment ComfyUI actually uses.
goto PY_DONE

:TryPy
if defined PYTHON exit /b 0
if exist "%~1" set "PYTHON=%~1"
exit /b 0

:GetNumpyVer
rem Sets NUMPY_VER to the installed numpy version (empty if none). Done via a temp
rem file, not  for /f ('"%PYTHON%" ... ^| findstr ...') : that inner command both
rem starts with a quote and contains more, so cmd /c strips the outer pair and
rem mangles the python path -> "The filename, directory name ... is incorrect".
set "NUMPY_VER="
"%PYTHON%" -m pip show numpy > "%TEMP%\aios_numpy.txt" 2>nul
for /f "tokens=2" %%v in ('findstr /b /c:"Version:" "%TEMP%\aios_numpy.txt"') do set "NUMPY_VER=%%v"
del "%TEMP%\aios_numpy.txt" >nul 2>&1
exit /b 0

:SystemPyPrompt
rem Nothing beside ComfyUI. A bare "python" is the machine's system install -
rem using it scatters ComfyUI's deps into the wrong place and can break other
rem Python projects, so make the user opt in.
where python >nul 2>&1
if errorlevel 1 exit /b 0
echo [WARN] No Python found beside ComfyUI - not the portable python_embeded,
echo        not the desktop standalone-env, not a venv. The only Python on
echo        PATH is your SYSTEM Python:
for /f "delims=" %%w in ('where python') do echo          %%w
echo.
echo        Installing into system Python is almost never what you want. It
echo        will not be the environment ComfyUI runs, and it can disturb
echo        other Python projects on this machine.
set "USE_SYS_PY="
set /p "USE_SYS_PY=Type YES to install into system Python anyway, or Enter to skip pip steps: "
if /i "%USE_SYS_PY%"=="YES" set "PYTHON=python"
exit /b 0

:PY_DONE
echo.

rem -- numpy guard ---------------------------------------------------------
rem ComfyUI core and many nodes still need numpy 1.x, but insightface / onnx /
rem older RTX deps happily drag it to 2.x mid-install. Record the version we
rem start with and pin it back at the end if anything moved it. Mirrors the
rem node pack's install_requirements (v1.20.2).
set "NUMPY_BEFORE="
if not "%PYTHON%"=="" (
    call :GetNumpyVer
    set "NUMPY_BEFORE=!NUMPY_VER!"
    if not "!NUMPY_VER!"=="" echo [INFO] numpy at start: !NUMPY_VER! ^(will restore this if a dependency changes it^)
)
echo.

if "%PYTHON%"=="" goto SKIP_PIP_UPGRADE
echo [PIP] Upgrading pip, setuptools, and wheel to the latest versions...
"%PYTHON%" -m pip install --upgrade pip --quiet
"%PYTHON%" -m pip install --upgrade setuptools wheel --quiet
rem wheel-stub (imported as wheel_stub) is a real, separate PyPI package
rem (an NVIDIA-published lightweight build backend, unrelated to the
rem regular "wheel" package) that Nvidia_RTX_Nodes_ComfyUI's requirements
rem pull in via a pyproject.toml declaring it as their build-backend.
rem It isn't installed by default and pip doesn't auto-fetch declared
rem build-backends in every case, so install it explicitly up front -
rem confirmed via direct testing that this (not wheel/setuptools) was the
rem actual fix for "Cannot import 'wheel_stub.buildapi'".
"%PYTHON%" -m pip install wheel-stub --quiet
echo.
:SKIP_PIP_UPGRADE

cd /d "%COMFY_DIR%\custom_nodes"

rem -- Main package: ComfyUI-TJ_NODE_STUDIO_ONE ----------------------------
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

rem -- Dependency custom node list ------------------------------------------
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
rem RIFEInterpolation - the gallery's "Interpolate a finished clip" post-process.
rem (Use GACLove/ComfyUI-VFI; the older ModelTC/ComfyUI-VFI repo 404s.)
set REPOS[21]=https://github.com/GACLove/ComfyUI-VFI

set COUNT=22

rem ComfyUI Manager names ComfyUI-VFI's folder after its pyproject "name"
rem (rife_comfyui_wrapper), not the repo. Clone it under that name so a later
rem Manager install/update doesn't drop a second copy and collide the node
rem class. Only set for entries where the two names differ; the rest clone
rem under their repo basename.
set "ALT[21]=rife_comfyui_wrapper"

echo [NOTE] pip may print "dependency resolver" conflict warnings below
echo        (e.g. protobuf version clashes between RMBG and audio tools) -
echo        those are expected and safe to ignore. The conflicting tools
echo        pin different versions of a shared package on purpose; each
echo        node only uses what it needs at runtime, so this doesn't
echo        break anything. It only matters if you notice one specific
echo        feature actually misbehaving.
echo.

rem The whole loop body lives in a called subroutine instead of a nested
rem parenthesized for/if block, so "do" only ever runs a single command.
for /L %%i in (0,1,21) do call :InstallRepo %%i
goto AFTER_REPOS

:InstallRepo
set "IDX=%~1"
set "URL=!REPOS[%IDX%]!"
for %%F in (!URL!) do set "FOLDER=%%~nxF"
if defined ALT[%IDX%] set "FOLDER=!ALT[%IDX%]!"

echo ------------------------------------------------------------------------
echo [%IDX%/21] !FOLDER!
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

rem -- numpy restore -------------------------------------------------------
if "%PYTHON%"=="" goto SKIP_NUMPY_RESTORE
if "%NUMPY_BEFORE%"=="" goto SKIP_NUMPY_RESTORE
call :GetNumpyVer
set "NUMPY_AFTER=%NUMPY_VER%"
if "%NUMPY_AFTER%"=="%NUMPY_BEFORE%" (
    echo [OK] numpy still %NUMPY_BEFORE% - no restore needed.
    goto SKIP_NUMPY_RESTORE
)
echo [FIX] numpy moved %NUMPY_BEFORE% -^> %NUMPY_AFTER% during install. Restoring %NUMPY_BEFORE%...
"%PYTHON%" -m pip install "numpy==%NUMPY_BEFORE%" --quiet
if errorlevel 1 (
    echo [WARN] Could not auto-restore numpy. Run this yourself:
    echo        "%PYTHON%" -m pip install "numpy==%NUMPY_BEFORE%"
) else (
    echo [OK] numpy restored to %NUMPY_BEFORE%.
)
:SKIP_NUMPY_RESTORE
echo.

echo ========================================================================
echo  Done!
echo ========================================================================
echo.
echo  Next:
echo   1. Restart ComfyUI to load the new nodes
echo      (run it with --enable-cors-header; port %COMFY_PORT%).
echo   2. Start the web app:  npm install  then  npm run dev
echo      (or double-click ai-one-studio-run.bat), open http://127.0.0.1:8774
echo.
echo  ComfyUI port %COMFY_PORT% was saved to public\comfy_port.txt. If you ever
echo  move ComfyUI to a different port, edit that file (just the number) and
echo  reload the page - no rebuild needed.
echo.
echo  [Model files are NOT installed by this script - download them yourself]
echo  [into models\. See ComfyUI-TJ_NODE_STUDIO_ONE's README.md and the]
echo  [install_requirements.bat instructions for the full list.]
echo  [The top bar's Restart button needs ComfyUI-Manager installed - most]
echo  [installs already have it, and this script does not install it.]
echo ========================================================================
pause
