class YouTubeLearningTracker {
    constructor() {
        this.state = {
            subjects: {
                physics: [],
                chemistry: [],
                biology: []
            },
            settings: {
                theme: 'light',
                autoSave: true
            },
            recentActivity: [],
            continueWatching: []
        };
        
        this.currentVideoId = null;
        this.player = null;
        this.selectedSubject = 'physics';
        
        this.init();
    }

    init() {
        this.loadState();
        this.setupEventListeners();
        this.renderHomePage();
        this.updateStorageInfo();
        this.detectSystemTheme();
        
        // Initialize YouTube API
        this.loadYouTubeAPI();
    }

    // State Management
    loadState() {
        const saved = localStorage.getItem('youtubeLearningTracker');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.state = {
                    ...this.state,
                    ...parsed,
                    subjects: {
                        physics: this.migrateVideos(parsed.subjects?.physics || []),
                        chemistry: this.migrateVideos(parsed.subjects?.chemistry || []),
                        biology: this.migrateVideos(parsed.subjects?.biology || [])
                    },
                    recentActivity: parsed.recentActivity || []
                };
            } catch (e) {
                console.error('Failed to load state:', e);
            }
        }
    }

    migrateVideos(videos) {
        return videos.map(video => ({
            ...video,
            watched: video.watched || false,
            progress: video.progress || 0,
            duration: video.duration || 0,
            lastWatched: video.lastWatched || null,
            addedDate: video.addedDate || Date.now(),
            thumbnail: video.thumbnail || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`
        }));
    }

    saveState() {
        try {
            localStorage.setItem('youtubeLearningTracker', JSON.stringify(this.state));
            this.updateStorageInfo();
            this.showToast('Progress saved successfully!', 'success');
        } catch (e) {
            console.error('Failed to save state:', e);
            this.showToast('Failed to save progress', 'error');
        }
    }

    // YouTube API
    loadYouTubeAPI() {
        if (window.YT && window.YT.Player) {
            return;
        }
        
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    onYouTubeIframeAPIReady() {
        // This function will be called by YouTube API
        console.log('YouTube API ready');
    }

    // Video Management
    extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
            /^([A-Za-z0-9_-]{11})$/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    async fetchVideoDetails(videoId) {
        try {
            // Using oEmbed API for basic info
            const response = await fetch(
                `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
            );
            
            if (!response.ok) throw new Error('Video not found');
            
            const data = await response.json();
            return {
                id: videoId,
                title: data.title,
                thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                author: data.author_name,
                addedDate: Date.now(),
                watched: false,
                progress: 0,
                duration: 0,
                lastWatched: null
            };
        } catch (error) {
            return {
                id: videoId,
                title: 'Unknown Video',
                thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                author: 'Unknown',
                addedDate: Date.now(),
                watched: false,
                progress: 0,
                duration: 0,
                lastWatched: null
            };
        }
    }

    async addVideos(links, subject) {
        this.showLoading('Processing videos...');
        
        const uniqueLinks = [...new Set(links.map(link => link.trim()).filter(link => link))];
        const results = {
            added: 0,
            duplicates: 0,
            invalid: 0,
            errors: []
        };
        
        let processed = 0;
        
        for (const link of uniqueLinks) {
            const videoId = this.extractVideoId(link);
            
            if (!videoId) {
                results.invalid++;
                results.errors.push(`Invalid link: ${link}`);
                continue;
            }
            
            // Check for duplicates
            if (this.state.subjects[subject].some(v => v.id === videoId)) {
                results.duplicates++;
                continue;
            }
            
            try {
                const videoDetails = await this.fetchVideoDetails(videoId);
                this.state.subjects[subject].unshift(videoDetails);
                results.added++;
                
                // Add to recent activity
                this.addActivity('video_added', {
                    subject,
                    title: videoDetails.title
                });
                
            } catch (error) {
                results.errors.push(`Failed to add: ${link}`);
            }
            
            processed++;
            this.updateLoadingProgress((processed / uniqueLinks.length) * 100);
        }
        
        this.hideLoading();
        this.saveState();
        this.renderSubjectPage(subject);
        this.updateCounts();
        
        // Show results
        let message = `Added ${results.added} new videos to ${subject}.`;
        if (results.duplicates > 0) message += ` Skipped ${results.duplicates} duplicates.`;
        if (results.invalid > 0) message += ` ${results.invalid} invalid links.`;
        
        this.showToast(message, results.added > 0 ? 'success' : 'warning');
        
        return results;
    }

    // Video Player
    playVideo(videoId, subject) {
        this.currentVideoId = videoId;
        this.currentSubject = subject;
        
        const video = this.state.subjects[subject].find(v => v.id === videoId);
        if (!video) return;
        
        // Create YouTube player
        if (!this.player) {
            this.player = new YT.Player('videoPlayer', {
                height: '100%',
                width: '100%',
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    controls: 1,
                    modestbranding: 1,
                    rel: 0,
                    showinfo: 0,
                    fs: 1
                },
                events: {
                    'onReady': this.onPlayerReady.bind(this),
                    'onStateChange': this.onPlayerStateChange.bind(this),
                    'onError': this.onPlayerError.bind(this)
                }
            });
        } else {
            this.player.loadVideoById(videoId);
        }
        
        // Update UI
        document.getElementById('videoModalTitle').textContent = video.title;
        this.updateVideoInfo(video);
        this.showModal('videoModal');
        
        // Add to continue watching
        this.addToContinueWatching(video, subject);
    }

    onPlayerReady(event) {
        console.log('Player ready');
    }

    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING) {
            this.startProgressTracking();
        } else if (event.data === YT.PlayerState.PAUSED) {
            this.stopProgressTracking();
        } else if (event.data === YT.PlayerState.ENDED) {
            this.markVideoAsWatched();
        }
    }

    onPlayerError(event) {
        console.error('Player error:', event.data);
        this.showToast('Error playing video', 'error');
    }

    startProgressTracking() {
        this.progressInterval = setInterval(() => {
            if (this.player && this.player.getCurrentTime) {
                const currentTime = this.player.getCurrentTime();
                const duration = this.player.getDuration();
                const progress = (currentTime / duration) * 100;
                
                this.updateVideoProgress(this.currentVideoId, this.currentSubject, progress, currentTime);
            }
        }, 1000);
    }

    stopProgressTracking() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    updateVideoProgress(videoId, subject, progress, currentTime) {
        const subjectVideos = this.state.subjects[subject];
        const videoIndex = subjectVideos.findIndex(v => v.id === videoId);
        
        if (videoIndex !== -1) {
            const video = subjectVideos[videoIndex];
            video.progress = Math.min(progress, 100);
            video.lastWatched = Date.now();
            
            // If progress > 95%, mark as watched
            if (progress >= 95 && !video.watched) {
                video.watched = true;
                video.progress = 100;
                this.updateCounts();
                this.showToast('Video marked as completed!', 'success');
                
                this.addActivity('video_completed', {
                    subject,
                    title: video.title
                });
            }
            
            // Move to top if in progress
            if (progress > 5 && progress < 95) {
                const video = subjectVideos.splice(videoIndex, 1)[0];
                subjectVideos.unshift(video);
            }
            
            this.saveState();
            this.renderSubjectPage(subject);
            this.renderContinueWatching();
        }
    }

    markVideoAsWatched() {
        if (!this.currentVideoId || !this.currentSubject) return;
        
        const subjectVideos = this.state.subjects[this.currentSubject];
        const videoIndex = subjectVideos.findIndex(v => v.id === this.currentVideoId);
        
        if (videoIndex !== -1) {
            const video = subjectVideos[videoIndex];
            video.watched = true;
            video.progress = 100;
            video.lastWatched = Date.now();
            
            // Move to bottom
            const videoToMove = subjectVideos.splice(videoIndex, 1)[0];
            subjectVideos.push(videoToMove);
            
            this.saveState();
            this.renderSubjectPage(this.currentSubject);
            this.updateCounts();
            
            this.addActivity('video_completed', {
                subject: this.currentSubject,
                title: video.title
            });
            
            this.showToast('Video marked as completed!', 'success');
        }
    }

    // UI Rendering
    renderHomePage() {
        this.updateCounts();
        this.renderContinueWatching();
        this.renderRecentActivity();
        this.renderOverviewCards();
    }

    renderSubjectPage(subject) {
        const containerId = `${subject}-videos`;
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const videos = this.state.subjects[subject];
        
        // Sort videos: in-progress first, then unwatched, then watched
        const sortedVideos = [...videos].sort((a, b) => {
            if (a.watched !== b.watched) return a.watched ? 1 : -1;
            if (a.progress > 5 && b.progress <= 5) return -1;
            if (a.progress <= 5 && b.progress > 5) return 1;
            return b.lastWatched - a.lastWatched;
        });
        
        container.innerHTML = sortedVideos.map(video => this.createVideoCard(video, subject)).join('');
        
        // Update count
        const unwatchedCount = videos.filter(v => !v.watched).length;
        const countElement = document.getElementById(`${subject}-videos-count`);
        if (countElement) {
            countElement.textContent = `${unwatchedCount} video${unwatchedCount !== 1 ? 's' : ''} to watch`;
        }
    }

    createVideoCard(video, subject) {
        const progressPercent = Math.round(video.progress);
        const isInProgress = video.progress > 5 && video.progress < 95 && !video.watched;
        
        return `
            <div class="video-card ${video.watched ? 'completed' : ''} ${isInProgress ? 'in-progress' : ''}" 
                 data-video-id="${video.id}" 
                 data-subject="${subject}">
                <div class="video-thumbnail">
                    <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
                    <button class="play-btn" onclick="app.playVideo('${video.id}', '${subject}')">
                        <i class="material-icons">${video.watched ? 'replay' : 'play_arrow'}</i>
                    </button>
                    ${isInProgress ? `
                        <div class="progress-overlay">
                            <div class="progress-indicator" style="width: ${progressPercent}%"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="video-info">
                    <h3 class="video-title" title="${video.title}">${video.title}</h3>
                    <div class="video-meta">
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${progressPercent}%"></div>
                            </div>
                            <div class="progress-text">
                                ${video.watched ? 'Completed' : `${progressPercent}% watched`}
                            </div>
                        </div>
                        <div class="video-status">
                            <span class="status-text">
                                ${isInProgress ? '<i class="material-icons" style="color: #fbbc04;">schedule</i> Continue' : 
                                  video.watched ? '<i class="material-icons" style="color: #34a853;">check_circle</i> Watched' : 
                                  '<i class="material-icons">play_circle</i> Watch'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderContinueWatching() {
        const container = document.getElementById('continueWatching');
        if (!container) return;
        
        // Get all in-progress videos
        const continueVideos = [];
        
        Object.entries(this.state.subjects).forEach(([subject, videos]) => {
            videos.forEach(video => {
                if (video.progress > 5 && video.progress < 95 && !video.watched) {
                    continueVideos.push({
                        ...video,
                        subject
                    });
                }
            });
        });
        
        // Sort by last watched
        continueVideos.sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0));
        
        container.innerHTML = continueVideos.slice(0, 6).map(item => `
            <div class="continue-card" onclick="app.playVideo('${item.id}', '${item.subject}')">
                <div class="continue-thumb">
                    <img src="${item.thumbnail}" alt="${item.title}">
                </div>
                <div class="continue-info">
                    <h4 title="${item.title}">${item.title}</h4>
                    <div class="continue-subject">
                        <i class="material-icons">${this.getSubjectIcon(item.subject)}</i>
                        <span>${item.subject.charAt(0).toUpperCase() + item.subject.slice(1)} • ${Math.round(item.progress)}% watched</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderOverviewCards() {
        Object.keys(this.state.subjects).forEach(subject => {
            const videos = this.state.subjects[subject];
            const total = videos.length;
            const watched = videos.filter(v => v.watched).length;
            const progress = total > 0 ? Math.round((watched / total) * 100) : 0;
            
            // Update home page counts
            const countElement = document.getElementById(`home-${subject}-count`);
            const progressElement = document.getElementById(`${subject}-progress`);
            
            if (countElement) countElement.textContent = total - watched;
            if (progressElement) progressElement.textContent = `${progress}%`;
        });
    }

    renderRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) return;
        
        const recentActivities = [...this.state.recentActivity]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 10);
        
        container.innerHTML = recentActivities.map(activity => {
            const icon = this.getActivityIcon(activity.type);
            const message = this.getActivityMessage(activity);
            const timeAgo = this.getTimeAgo(activity.timestamp);
            
            return `
                <div class="activity-item">
                    <div class="activity-icon">
                        <i class="material-icons">${icon}</i>
                    </div>
                    <div class="activity-details">
                        <p>${message}</p>
                        <small>${timeAgo}</small>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Utility Functions
    getSubjectIcon(subject) {
        const icons = {
            physics: 'science',
            chemistry: 'biotech',
            biology: 'eco'
        };
        return icons[subject] || 'video_library';
    }

    getActivityIcon(type) {
        const icons = {
            video_added: 'add_circle',
            video_completed: 'check_circle',
            video_watched: 'play_circle',
            subject_changed: 'swap_horiz',
            settings_updated: 'settings'
        };
        return icons[type] || 'notifications';
    }

    getActivityMessage(activity) {
        const { type, data } = activity;
        
        switch (type) {
            case 'video_added':
                return `Added "${data.title}" to ${data.subject}`;
            case 'video_completed':
                return `Completed "${data.title}" in ${data.subject}`;
            case 'video_watched':
                return `Watched "${data.title}" in ${data.subject}`;
            default:
                return 'Activity recorded';
        }
    }

    getTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60,
            second: 1
        };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
            }
        }
        
        return 'just now';
    }

    addActivity(type, data) {
        this.state.recentActivity.push({
            type,
            data,
            timestamp: Date.now()
        });
        
        // Keep only last 50 activities
        if (this.state.recentActivity.length > 50) {
            this.state.recentActivity.shift();
        }
        
        this.saveState();
        this.renderRecentActivity();
    }

    addToContinueWatching(video, subject) {
        const existingIndex = this.state.continueWatching.findIndex(
            item => item.id === video.id && item.subject === subject
        );
        
        if (existingIndex !== -1) {
            this.state.continueWatching.splice(existingIndex, 1);
        }
        
        this.state.continueWatching.unshift({
            id: video.id,
            subject,
            title: video.title,
            thumbnail: video.thumbnail,
            progress: video.progress,
            lastWatched: Date.now()
        });
        
        // Keep only last 10 items
        if (this.state.continueWatching.length > 10) {
            this.state.continueWatching.pop();
        }
        
        this.saveState();
    }

    // Count Updates
    updateCounts() {
        Object.keys(this.state.subjects).forEach(subject => {
            const count = this.state.subjects[subject].filter(v => !v.watched).length;
            const countElement = document.getElementById(`${subject}-count`);
            if (countElement) {
                countElement.textContent = count;
            }
        });
    }

    // Storage Management
    updateStorageInfo() {
        try {
            const data = localStorage.getItem('youtubeLearningTracker') || '';
            const usedKB = (data.length * 2) / 1024; // Approximate size in KB
            const maxKB = 5120; // 5MB limit for localStorage
            
            const percentage = Math.min((usedKB / maxKB) * 100, 100);
            const fillElement = document.getElementById('storageFill');
            
            if (fillElement) {
                fillElement.style.width = `${percentage}%`;
            }
        } catch (e) {
            console.error('Failed to update storage info:', e);
        }
    }

    // Import/Export
    exportData() {
        const data = {
            ...this.state,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `youtube-learning-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showToast('Data exported successfully!', 'success');
    }

    importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    
                    // Validate imported data
                    if (!importedData.subjects || !importedData.settings) {
                        throw new Error('Invalid backup file format');
                    }
                    
                    // Merge imported data
                    this.state = {
                        ...this.state,
                        ...importedData,
                        subjects: {
                            physics: this.migrateVideos(importedData.subjects.physics || []),
                            chemistry: this.migrateVideos(importedData.subjects.chemistry || []),
                            biology: this.migrateVideos(importedData.subjects.biology || [])
                        }
                    };
                    
                    this.saveState();
                    this.renderHomePage();
                    Object.keys(this.state.subjects).forEach(subject => this.renderSubjectPage(subject));
                    
                    this.showToast('Data imported successfully!', 'success');
                    resolve();
                } catch (error) {
                    this.showToast('Failed to import data: Invalid file format', 'error');
                    reject(error);
                }
            };
            
            reader.onerror = () => {
                this.showToast('Failed to read file', 'error');
                reject(new Error('File read error'));
            };
            
            reader.readAsText(file);
        });
    }

    // Theme Management
    detectSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.setTheme('dark');
        }
    }

    setTheme(theme) {
        this.state.settings.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        // Update theme toggle icon
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.innerHTML = `<i class="material-icons">${theme === 'dark' ? 'light_mode' : 'dark_mode'}</i>`;
        }
    }

    toggleTheme() {
        const newTheme = this.state.settings.theme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
        this.showToast(`Switched to ${newTheme} theme`, 'success');
    }

    // Modal Management
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            
            // Clean up video player
            if (modalId === 'videoModal' && this.player) {
                this.player.stopVideo();
                this.stopProgressTracking();
            }
        }
    }

    // Loading States
    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loadingOverlay');
        const text = document.getElementById('loadingText');
        
        if (overlay && text) {
            text.textContent = message;
            overlay.classList.add('active');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    updateLoadingProgress(percent) {
        const progressBar = document.querySelector('.loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }

    // Toast Notifications
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="material-icons">${this.getToastIcon(type)}</i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Remove toast after animation
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    getToastIcon(type) {
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning',
            info: 'info'
        };
        return icons[type] || 'info';
    }

    // Event Listeners Setup
    setupEventListeners() {
        // Sidebar navigation
        document.querySelectorAll('.subject-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const subject = e.currentTarget.dataset.subject;
                this.navigateTo(subject);
            });
        });

        // Overview cards navigation
        document.querySelectorAll('.overview-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const subject = e.currentTarget.dataset.subject;
                this.navigateTo(subject);
            });
        });

        // Add video FAB
        document.getElementById('addVideoFab')?.addEventListener('click', () => {
            this.showAddVideoModal();
        });

        // Theme toggle
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });

        // Export button
        document.getElementById('exportBtn')?.addEventListener('click', () => {
            this.exportData();
        });

        // Import button
        document.getElementById('importBtn')?.addEventListener('click', () => {
            this.showImportModal();
        });

        // Modal close buttons
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.hideModal(modal.id);
                }
            });
        });

        // Close modals on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideModal(modal.id);
                }
            });
        });

        // Subject selection in add video modal
        document.querySelectorAll('.subject-option').forEach(option => {
            option.addEventListener('click', (e) => {
                document.querySelectorAll('.subject-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                e.currentTarget.classList.add('selected');
                this.selectedSubject = e.currentTarget.dataset.subject;
            });
        });

        // Add videos button
        document.getElementById('addVideosBtn')?.addEventListener('click', () => {
            this.processVideoLinks();
        });

        // Clear links button
        document.getElementById('clearLinks')?.addEventListener('click', () => {
            document.getElementById('videoLinks').value = '';
            document.getElementById('linkAnalysis').innerHTML = '';
        });

        // Analyze links button
        document.getElementById('analyzeLinks')?.addEventListener('click', () => {
            this.analyzeLinks();
        });

        // Import file input
        document.getElementById('importFile')?.addEventListener('change', (e) => {
            this.previewImportFile(e.target.files[0]);
        });

        // Confirm import button
        document.getElementById('confirmImport')?.addEventListener('click', () => {
            const fileInput = document.getElementById('importFile');
            if (fileInput.files.length > 0) {
                this.importData(fileInput.files[0]).then(() => {
                    this.hideModal('importModal');
                });
            }
        });

        // Menu button for mobile
        document.getElementById('menuBtn')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('active');
        });

        document.getElementById('closeSidebar')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('active');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape to close modals
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal.active');
                if (openModal) {
                    this.hideModal(openModal.id);
                }
            }
            
            // Ctrl+S to save
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveState();
            }
            
            // Ctrl+E to export
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.exportData();
            }
            
            // Ctrl+O to import
            if (e.ctrlKey && e.key === 'o') {
                e.preventDefault();
                this.showImportModal();
            }
        });

        // Auto-save on page unload
        window.addEventListener('beforeunload', () => {
            if (this.state.settings.autoSave) {
                this.saveState();
            }
        });

        // Periodic auto-save
        setInterval(() => {
            if (this.state.settings.autoSave) {
                this.saveState();
            }
        }, 30000); // Every 30 seconds
    }

    // Navigation
    navigateTo(subject) {
        // Update active states
        document.querySelectorAll('.subject-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.subject-item[data-subject="${subject}"]`)?.classList.add('active');
        
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Show target page
        const targetPage = subject === 'home' ? 'home-page' : `${subject}-page`;
        document.getElementById(targetPage)?.classList.add('active');
        
        // Update sidebar on mobile
        document.getElementById('sidebar')?.classList.remove('active');
        
        // Render subject page if needed
        if (subject !== 'home') {
            this.renderSubjectPage(subject);
        }
        
        // Add activity
        if (subject !== 'home') {
            this.addActivity('subject_changed', { subject });
        }
    }

    // Add Video Modal Functions
    showAddVideoModal() {
        // Reset form
        document.getElementById('videoLinks').value = '';
        document.getElementById('linkAnalysis').innerHTML = '';
        document.querySelectorAll('.subject-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        document.querySelector('.subject-option[data-subject="physics"]').classList.add('selected');
        this.selectedSubject = 'physics';
        
        this.showModal('addVideoModal');
    }

    analyzeLinks() {
        const textarea = document.getElementById('videoLinks');
        const links = textarea.value.split(/[\n,]+/).map(link => link.trim()).filter(link => link);
        
        if (links.length === 0) {
            this.showToast('Please enter some YouTube links', 'warning');
            return;
        }
        
        const analysisContainer = document.getElementById('linkAnalysis');
        let validCount = 0;
        let invalidCount = 0;
        
        analysisContainer.innerHTML = `
            <h4>Link Analysis Results</h4>
            <div class="analysis-list">
                ${links.map(link => {
                    const videoId = this.extractVideoId(link);
                    const isValid = !!videoId;
                    
                    if (isValid) validCount++;
                    else invalidCount++;
                    
                    return `
                        <div class="analysis-result">
                            <div class="result-status ${isValid ? 'valid' : 'invalid'}">
                                <i class="material-icons">${isValid ? 'check' : 'close'}</i>
                            </div>
                            <div class="result-details">
                                <p>${link}</p>
                                <small>${isValid ? 'Valid YouTube link' : 'Invalid or unsupported link'}</small>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="analysis-summary">
                <p><strong>Summary:</strong> ${validCount} valid, ${invalidCount} invalid links</p>
            </div>
        `;
    }

    async processVideoLinks() {
        const textarea = document.getElementById('videoLinks');
        const links = textarea.value.split(/[\n,]+/).map(link => link.trim()).filter(link => link);
        
        if (links.length === 0) {
            this.showToast('Please enter some YouTube links', 'warning');
            return;
        }
        
        if (!this.selectedSubject) {
            this.showToast('Please select a subject', 'warning');
            return;
        }
        
        if (links.length > 50) {
            this.showToast(`Processing ${links.length} links... This may take a moment`, 'info');
        }
        
        const results = await this.addVideos(links, this.selectedSubject);
        
        // Close modal if successful
        if (results.added > 0) {
            this.hideModal('addVideoModal');
        }
    }

    // Import Modal Functions
    showImportModal() {
        // Reset form
        document.getElementById('importFile').value = '';
        document.getElementById('backupPreview').innerHTML = '';
        document.getElementById('confirmImport').disabled = true;
        
        this.showModal('importModal');
    }

    previewImportFile(file) {
        if (!file) return;
        
        const preview = document.getElementById('backupPreview');
        const confirmBtn = document.getElementById('confirmImport');
        
        preview.innerHTML = `
            <div class="loading-spinner" style="width: 20px; height: 20px;"></div>
            <p>Analyzing backup file...</p>
        `;
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Validate
                const isValid = data.subjects && data.settings;
                const videoCount = isValid ? 
                    (data.subjects.physics?.length || 0) + 
                    (data.subjects.chemistry?.length || 0) + 
                    (data.subjects.biology?.length || 0) : 0;
                
                preview.innerHTML = isValid ? `
                    <div class="backup-details">
                        <p><strong>Backup Details:</strong></p>
                        <ul>
                            <li>Export date: ${data.exportDate ? new Date(data.exportDate).toLocaleDateString() : 'Unknown'}</li>
                            <li>Physics videos: ${data.subjects.physics?.length || 0}</li>
                            <li>Chemistry videos: ${data.subjects.chemistry?.length || 0}</li>
                            <li>Biology videos: ${data.subjects.biology?.length || 0}</li>
                            <li>Total videos: ${videoCount}</li>
                        </ul>
                        <p class="warning-text">
                            <i class="material-icons">warning</i>
                            Importing will replace your current data!
                        </p>
                    </div>
                ` : `
                    <div class="backup-error">
                        <i class="material-icons" style="color: #ea4335;">error</i>
                        <p>Invalid backup file format</p>
                    </div>
                `;
                
                confirmBtn.disabled = !isValid;
            } catch (error) {
                preview.innerHTML = `
                    <div class="backup-error">
                        <i class="material-icons" style="color: #ea4335;">error</i>
                        <p>Error reading file: ${error.message}</p>
                    </div>
                `;
                confirmBtn.disabled = true;
            }
        };
        
        reader.onerror = () => {
            preview.innerHTML = `
                <div class="backup-error">
                    <i class="material-icons" style="color: #ea4335;">error</i>
                    <p>Failed to read file</p>
                </div>
            `;
            confirmBtn.disabled = true;
        };
        
        reader.readAsText(file);
    }

    // Update video info in modal
    updateVideoInfo(video) {
        const infoElement = document.getElementById('videoInfo');
        if (!infoElement) return;
        
        const progress = Math.round(video.progress);
        const status = video.watched ? 'Completed' : (progress > 5 ? `${progress}% watched` : 'Not started');
        
        infoElement.innerHTML = `
            <div class="video-details">
                <h4>${video.title}</h4>
                <p><i class="material-icons">person</i> ${video.author || 'Unknown creator'}</p>
                <div class="video-progress-info">
                    <p><i class="material-icons">play_circle</i> Status: ${status}</p>
                    <p><i class="material-icons">calendar_today</i> Added: ${new Date(video.addedDate).toLocaleDateString()}</p>
                    ${video.lastWatched ? `
                        <p><i class="material-icons">history</i> Last watched: ${new Date(video.lastWatched).toLocaleDateString()}</p>
                    ` : ''}
                </div>
                <div class="video-actions">
                    <button class="btn-secondary" onclick="app.markVideoAsWatched()">
                        <i class="material-icons">check_circle</i> Mark as Completed
                    </button>
                </div>
            </div>
        `;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new YouTubeLearningTracker();
    
    // Expose onYouTubeIframeAPIReady for YouTube API
    window.onYouTubeIframeAPIReady = () => {
        console.log('YouTube API Ready');
    };
});
