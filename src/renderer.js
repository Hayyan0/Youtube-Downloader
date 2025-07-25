document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('min-btn').addEventListener('click', () => window.electronAPI.send('minimize-app'));
    document.getElementById('max-btn').addEventListener('click', () => window.electronAPI.send('maximize-app'));
    document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.send('close-app'));

    const outputDirInput = document.getElementById('output-dir');
    const browseBtn = document.getElementById('browse-btn');
    const downloadBtn = document.getElementById('download-btn');
    const urlInput = document.getElementById('url-input');
    const typeSelect = document.getElementById('type-select');
    const qualitySelect = document.getElementById('quality-select');

    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar-inner');
    const progressText = document.getElementById('progress-text');
    const progressDetails = document.getElementById('progress-details');

    const dependencyNotification = document.getElementById('dependency-notification');
    const downloadDependencyBtn = document.getElementById('download-dependency-btn');
    const mainForm = document.getElementById('main-form');

    const ytdlpUpdateNotification = document.getElementById('update-notification');
    const updateYtdlpBtn = document.getElementById('update-ytdlp-btn');

    const appUpdateNotification = document.getElementById('app-update-notification');
    const appUpdateMessage = document.getElementById('app-update-message');
    const restartAppBtn = document.getElementById('restart-app-btn');


    let downloadState = { mode: 'unknown', totalParts: 1, currentPart: 1 };

    const qualityOptions = {
        video: {
            'Best Available': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
            '4K (2160p)': 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]',
            '1440p': 'bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]',
            '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
            '720p': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]',
            '480p': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]',
            '360p': 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]',
            '240p': 'bestvideo[height<=240][ext=mp4]+bestaudio[ext=m4a]/best[height<=240]',
        },
        audio: {
            'Best Quality (MP3)': '0',
            'High Quality (MP3)': '3',
            'Medium Quality (MP3)': '5',
            'Low Quality (MP3)': '7',
        },
        thumbnail: {
            'Max Resolution': 'maxresdefault',
            'High Quality': 'hqdefault',
            'Medium Quality': 'mqdefault',
            'Standard': 'sddefault',
        }
    };

    function setFormEnabled(enabled) {
        mainForm.style.opacity = enabled ? '1' : '0.5';
        mainForm.style.pointerEvents = enabled ? 'auto' : 'none';
    }

    function resetDownloadUI() {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download';
        progressBar.style.backgroundColor = 'var(--accent-color)';
        if (!progressDetails.innerHTML.includes('Sign In')) {
            setTimeout(() => {
                if (!downloadBtn.disabled) {
                    progressContainer.classList.add('hidden');
                }
            }, 3000);
        }
    }

    browseBtn.addEventListener('click', async () => {
        const folderPath = await window.electronAPI.invoke('select-folder');
        if (folderPath) outputDirInput.value = folderPath;
    });

    downloadBtn.addEventListener('click', () => {
        const url = urlInput.value;
        const type = typeSelect.value;
        const quality = qualitySelect.value;
        const outputDir = outputDirInput.value;

        if (!url.trim() || !outputDir.trim()) {
            alert('Please provide a valid URL and select an output directory.');
            return;
        }

        downloadState = { mode: 'unknown', totalParts: 1, currentPart: 1 };

        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        progressDetails.textContent = 'Initializing...';
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';

        window.electronAPI.send('start-download', { url, type, quality, outputDir });
    });

    downloadDependencyBtn.addEventListener('click', () => {
        window.electronAPI.send('download-ytdlp');
    });

    updateYtdlpBtn.addEventListener('click', () => {
        ytdlpUpdateNotification.classList.add('hidden');
        window.electronAPI.send('download-ytdlp');
    });

    restartAppBtn.addEventListener('click', () => {
        window.electronAPI.send('restart-app');
    });

    typeSelect.addEventListener('change', updateQualityOptions);

    window.electronAPI.on('app-update-available', (info) => {
        appUpdateNotification.classList.remove('hidden');
        appUpdateMessage.textContent = `A new version (v${info.version}) is available. Downloading...`;
    });

    window.electronAPI.on('app-update-downloaded', (info) => {
        appUpdateNotification.classList.remove('hidden');
        appUpdateMessage.textContent = `Update v${info.version} downloaded. Restart the app to install.`;
        restartAppBtn.classList.remove('hidden');
    });


    window.electronAPI.on('ytdlp-status', ({ found }) => {
        if (found) {
            dependencyNotification.classList.add('hidden');
            setFormEnabled(true);
        } else {
            dependencyNotification.classList.remove('hidden');
            setFormEnabled(false);
        }
    });

    window.electronAPI.on('ytdlp-update-available', () => {
        ytdlpUpdateNotification.classList.remove('hidden');
    });


    window.electronAPI.on('ytdlp-dependency-download-start', () => {
        progressContainer.classList.remove('hidden');
        progressBar.style.backgroundColor = 'var(--accent-color)';
        progressText.textContent = '0%';
        progressDetails.textContent = 'Downloading yt-dlp.exe...';
        downloadDependencyBtn.disabled = true;
        downloadDependencyBtn.textContent = 'Downloading...';
        updateYtdlpBtn.disabled = true;
        updateYtdlpBtn.textContent = 'Updating...';
    });

    window.electronAPI.on('ytdlp-dependency-download-progress', (progress) => {
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress.toFixed(1)}%`;
    });

    window.electronAPI.on('ytdlp-dependency-download-finished', () => {
        progressDetails.textContent = 'yt-dlp downloaded successfully! ✅';
        downloadDependencyBtn.disabled = false;
        downloadDependencyBtn.textContent = 'Download yt-dlp.exe';
        updateYtdlpBtn.disabled = false;
        updateYtdlpBtn.textContent = 'Update Now';
        ytdlpUpdateNotification.classList.add('hidden');
        setTimeout(() => progressContainer.classList.add('hidden'), 3000);
    });

    window.electronAPI.on('ytdlp-dependency-download-error', (error) => {
        progressDetails.textContent = `Error downloading yt-dlp: ${error}`;
        progressBar.style.backgroundColor = 'var(--error-color)';
        downloadDependencyBtn.disabled = false;
        downloadDependencyBtn.textContent = 'Download yt-dlp.exe';
        updateYtdlpBtn.disabled = false;
        updateYtdlpBtn.textContent = 'Update Now';
    });

    window.electronAPI.on('ytdlp-output', (data) => {
        const lines = data.split('\r');
        const lastLine = lines[lines.length - 1];

        const trimmedLine = lastLine.trim();
        if (!trimmedLine) return;

        const hlsFragRegex = /at\s+(.+?)\s+ETA\s+(.+?)\s+\(frag (\d+)\/(\d+)\)/;
        const hlsFragMatch = trimmedLine.match(hlsFragRegex);
        if (hlsFragMatch) {
            downloadState.mode = 'fragment';
            const [, speedStr, etaStr, currentFragStr, totalFragsStr] = hlsFragMatch;
            const currentFrag = parseInt(currentFragStr);
            const totalFrags = parseInt(totalFragsStr);
            const progress = totalFrags > 0 ? (currentFrag / totalFrags) * 100 : 0;

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress.toFixed(1)}%`;
            progressDetails.textContent = `Frag: ${currentFrag}/${totalFrags} | ${speedStr} (ETA: ${etaStr})`;
            return;
        }

        const percentRegex = /\[download\]\s+([\d\.]+)% of ~?(.+?)\s+at\s+(.+?)\s+ETA\s+(.+)/;
        const percentMatch = trimmedLine.match(percentRegex);
        if (percentMatch) {
            downloadState.mode = 'percent';
            const [, percentStr, sizeStr, speedStr, etaStr] = percentMatch;
            const currentPercent = parseFloat(percentStr);
            const progressOfCompletedParts = ((downloadState.currentPart - 1) / downloadState.totalParts) * 100;
            const progressOfCurrentPart = currentPercent / downloadState.totalParts;
            const totalProgress = Math.min(100, progressOfCompletedParts + progressOfCurrentPart);

            progressBar.style.width = `${totalProgress}%`;
            progressText.textContent = `${totalProgress.toFixed(1)}%`;
            progressDetails.textContent = `Part ${downloadState.currentPart}/${downloadState.totalParts} | ${sizeStr} at ${speedStr} (ETA: ${etaStr})`;
            return;
        }

        const partsRegex = /\[info\] Downloading video \d+ of (\d+)/;
        if (partsRegex.test(trimmedLine)) {
            downloadState.totalParts = parseInt(trimmedLine.match(partsRegex)[1], 10);
        }

        if (trimmedLine.includes('[Merger]') || trimmedLine.includes('[ExtractAudio]')) {
            progressDetails.textContent = 'Finalizing...';
            progressBar.style.width = '99.5%';
        } else if (trimmedLine.startsWith('[youtube]')) {
            progressDetails.textContent = 'Processing URL...';
        } else if (trimmedLine.startsWith('[STDERR]')) {
            if (!progressDetails.innerHTML.includes('Sign In')) {
                progressDetails.textContent = `Error: ${trimmedLine.substring(8)}`;
            }
        }
    });

    window.electronAPI.on('download-finished', (code) => {
        if (progressDetails.innerHTML.includes('Sign In')) {
            resetDownloadUI();
            return;
        }

        if (code === 0) {
            progressBar.style.width = '100%';
            progressText.textContent = '100%';
            progressDetails.textContent = 'Download completed successfully! ✅';
        } else {
            if (!progressDetails.textContent.startsWith('Error:')) {
                progressDetails.textContent = `Download failed (code ${code}).`;
            }
            progressBar.style.backgroundColor = 'var(--error-color)';
        }
        resetDownloadUI();
    });

    window.electronAPI.on('ytdlp-cookie-error', () => {
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = 'var(--error-color)';
        progressText.textContent = 'Error';
        progressDetails.innerHTML = `Cookies error. Try using <a href="https://one.one.one.one/" target="_blank" class="error-link">1.1.1.1</a> or <button id="sign-in-btn" class="inline-btn">Sign In</button>`;

        document.getElementById('sign-in-btn').addEventListener('click', () => {
            progressDetails.textContent = 'Opening sign-in window...';
            window.electronAPI.send('open-login-window');
        });
    });

    window.electronAPI.on('login-complete', () => {
        progressDetails.textContent = 'Sign-in complete. Please try the download again.';
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download';
    });

    function createCustomSelect(wrapper) {
        const originalSelect = wrapper.querySelector('select');
        if (!originalSelect) return;

        originalSelect.style.display = 'none';

        const existingSelected = wrapper.querySelector('.select-selected');
        const existingItems = wrapper.querySelector('.select-items');
        if (existingSelected) existingSelected.remove();
        if (existingItems) existingItems.remove();

        const selectedDiv = document.createElement('DIV');
        selectedDiv.setAttribute('class', 'select-selected');
        selectedDiv.innerHTML = originalSelect.options[originalSelect.selectedIndex]?.innerHTML || '&nbsp;';
        wrapper.appendChild(selectedDiv);

        const optionsListDiv = document.createElement('DIV');
        optionsListDiv.setAttribute('class', 'select-items select-hide');

        for (let i = 0; i < originalSelect.length; i++) {
            const optionDiv = document.createElement('DIV');
            optionDiv.innerHTML = originalSelect.options[i].innerHTML;

            if (i === originalSelect.selectedIndex) {
                optionDiv.classList.add('same-as-selected');
            }

            optionDiv.addEventListener('click', function () {
                const selectEl = this.parentNode.parentNode.querySelector('select');
                const selectedDisplay = this.parentNode.previousSibling;

                for (let j = 0; j < selectEl.length; j++) {
                    if (selectEl.options[j].innerHTML === this.innerHTML) {
                        selectEl.selectedIndex = j;
                        selectedDisplay.innerHTML = this.innerHTML;

                        const currentSelected = this.parentNode.querySelector('.same-as-selected');
                        if (currentSelected) currentSelected.classList.remove('same-as-selected');
                        this.classList.add('same-as-selected');
                        break;
                    }
                }
                selectedDisplay.click();
                selectEl.dispatchEvent(new Event('change'));
            });
            optionsListDiv.appendChild(optionDiv);
        }
        wrapper.appendChild(optionsListDiv);

        selectedDiv.addEventListener('click', function (e) {
            e.stopPropagation();
            closeAllSelect(this);
            this.nextSibling.classList.toggle('select-hide');
            this.classList.toggle('select-arrow-active');
        });
    }

    function closeAllSelect(elmnt) {
        const selectItems = document.getElementsByClassName('select-items');
        const selectSelected = document.getElementsByClassName('select-selected');
        for (let i = 0; i < selectSelected.length; i++) {
            if (elmnt !== selectSelected[i]) {
                selectSelected[i].classList.remove('select-arrow-active');
            }
        }
        for (let i = 0; i < selectItems.length; i++) {
            if (elmnt === null || (elmnt && elmnt.nextSibling !== selectItems[i])) {
                selectItems[i].classList.add('select-hide');
            }
        }
    }

    function updateQualityOptions() {
        const type = typeSelect.value;
        const qualities = qualityOptions[type];
        qualitySelect.innerHTML = '';

        for (const name in qualities) {
            const option = document.createElement('option');
            option.value = qualities[name];
            option.textContent = name;
            qualitySelect.appendChild(option);
        }
        createCustomSelect(qualitySelect.closest('.custom-select-wrapper'));
    }

    document.querySelectorAll('.custom-select-wrapper').forEach(createCustomSelect);
    updateQualityOptions();
    document.addEventListener('click', () => closeAllSelect(null));
});