@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

echo ========================================================================
echo   AI ONE STUDIO — ComfyUI Backend Dependency Installer
echo   Installs ComfyUI-TJ_NODE_STUDIO_ONE and every custom node / Python
echo   package the 6 tools (MiniMax H3, Krea2, Z-Image, Flux2 Klein,
echo   Qwen Image 2511, SDXL) need, plus ComfyUI-Crystools (powers the
echo   live CPU/RAM/GPU/VRAM/temp monitor in the site's top bar).
echo   Already-installed nodes are skipped.
echo ========================================================================
echo.

:: ── ComfyUI 경로 입력 ────────────────────────────────────────────────────
set "COMFY_DIR="
:ASK_PATH
set /p "COMFY_DIR=이미 설치된 ComfyUI 폴더 경로를 입력하세요 (custom_nodes가 있는 폴더): "
if "%COMFY_DIR%"=="" (
    echo [ERROR] 경로를 입력해주세요.
    goto ASK_PATH
)
:: 끝에 붙은 백슬래시 제거
if "%COMFY_DIR:~-1%"=="\" set "COMFY_DIR=%COMFY_DIR:~0,-1%"

if not exist "%COMFY_DIR%\custom_nodes" (
    echo [ERROR] "%COMFY_DIR%\custom_nodes" 폴더를 찾을 수 없습니다.
    echo         ComfyUI 루트 폴더(예: C:\ComfyUI 또는 ...\ComfyUI_windows_portable\ComfyUI)를 입력했는지 확인하세요.
    echo.
    goto ASK_PATH
)
echo [OK] ComfyUI: %COMFY_DIR%
echo.

:: ── git 확인 ─────────────────────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git이 설치되어 있지 않습니다. https://git-scm.com/downloads 에서 설치 후 다시 실행하세요.
    pause
    exit /b 1
)

:: ── Python 경로 탐색 ─────────────────────────────────────────────────────
:: ComfyUI portable(=python_embeded는 ComfyUI 폴더의 한 단계 위)와 venv(안쪽 또는
:: 한 단계 위 둘 다) 설치 방식을 모두 지원한다.
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
    echo [WARN] Python을 찾지 못했습니다. pip install 단계는 건너뜁니다.
    echo        ComfyUI가 사용하는 Python 환경에서 이 스크립트를 실행하세요.
) else (
    echo [INFO] Python: %PYTHON%
)
echo.

cd /d "%COMFY_DIR%\custom_nodes"

:: ── 메인 패키지: ComfyUI-TJ_NODE_STUDIO_ONE ────────────────────────────────
echo ========================================================================
echo  [MAIN] ComfyUI-TJ_NODE_STUDIO_ONE
echo ========================================================================
if exist "ComfyUI-TJ_NODE_STUDIO_ONE" (
    echo [SKIP] 이미 설치되어 있습니다.
) else (
    echo [INSTALL] Cloning...
    git clone https://github.com/designloves2/ComfyUI-TJ_NODE_STUDIO_ONE.git
    if errorlevel 1 (
        echo [ERROR] git clone 실패. 인터넷 연결을 확인하세요.
    ) else (
        echo [OK] Cloned.
    )
)
if not "%PYTHON%"=="" (
    if exist "ComfyUI-TJ_NODE_STUDIO_ONE\requirements.txt" (
        echo [PIP] ComfyUI-TJ_NODE_STUDIO_ONE requirements 설치 중...
        "%PYTHON%" -m pip install -r "ComfyUI-TJ_NODE_STUDIO_ONE\requirements.txt" --quiet
        if errorlevel 1 (echo [WARN] 일부 패키지 설치 실패 — 수동 확인 필요.) else (echo [PIP] Done.)
    )
)
echo.

:: ── 의존 커스텀 노드 목록 ────────────────────────────────────────────────
:: (ComfyUI-TJ_NODE_STUDIO_ONE/install_requirements.bat 과 동일한 목록 — 6개
:: 이미지 도구 + MiniMax H3 영상 노드가 필요로 하는 전부)
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

set COUNT=19

for /L %%i in (0,1,18) do (
    set "URL=!REPOS[%%i]!"
    for %%F in (!URL!) do set "FOLDER=%%~nxF"

    echo ------------------------------------------------------------------------
    echo [%%i/18] !FOLDER!
    echo         !URL!

    if exist "!FOLDER!" (
        echo [SKIP] 이미 설치되어 있습니다.
    ) else (
        echo [INSTALL] Cloning...
        git clone "!URL!" "!FOLDER!"
        if errorlevel 1 (
            echo [ERROR] git clone 실패. 인터넷 연결을 확인하세요.
        ) else (
            echo [OK] Cloned.
            if not "%PYTHON%"=="" (
                if exist "!FOLDER!\requirements.txt" (
                    echo [PIP] requirements 설치 중...

                    rem dlib은 소스 빌드에 cmake/C++ 컴파일러가 필요해 실패의 주 원인이므로
                    rem 걸러내고 사전 컴파일된 wheel(dlib-bin)로 대체 설치한다.
                    set "REQ_FILE=!FOLDER!\requirements.txt"
                    set "REQ_FILTERED=%TEMP%\aios_req_!FOLDER!.txt"
                    findstr /v /i "^dlib" "!REQ_FILE!" > "!REQ_FILTERED!"

                    "%PYTHON%" -m pip install -r "!REQ_FILTERED!" --quiet
                    if errorlevel 1 (
                        echo [WARN] pip install 중 오류 발생 — 수동 확인 필요.
                    ) else (
                        echo [PIP] Done.
                    )

                    findstr /i /r "^dlib" "!REQ_FILE!" >nul
                    if not errorlevel 1 (
                        echo [PIP] dlib ^(사전 빌드된 wheel^) 설치 중...
                        "%PYTHON%" -m pip install dlib-bin --quiet
                        if errorlevel 1 (
                            echo [WARN] dlib 설치 건너뜀 — 얼굴 인식 관련 기능이 제한될 수 있습니다.
                        ) else (
                            echo [PIP] dlib 설치 완료.
                        )
                    )

                    del "!REQ_FILTERED!" >nul 2>&1
                )
            )
        )
    )
    echo.
)

echo ========================================================================
echo  완료! ComfyUI를 재시작하면 모든 노드가 로드됩니다.
echo  Done! Restart ComfyUI to load every node.
echo ========================================================================
echo.
echo  [모델 파일은 이 스크립트로 설치되지 않습니다 — 직접 다운로드해서]
echo  [models\ 폴더에 넣어야 합니다. 자세한 목록은 ComfyUI-TJ_NODE_STUDIO_ONE]
echo  [의 README.md와 install_requirements.bat 안내 문구를 참고하세요.]
echo  [상단바의 ⟳ Restart 버튼은 ComfyUI-Manager가 설치되어 있어야 동작합니다]
echo  [— 대부분 이미 설치돼 있고, 이 스크립트는 별도로 설치하지 않습니다.]
echo ========================================================================
pause
