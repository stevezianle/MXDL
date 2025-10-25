// 服务器状态管理器
class ServerStatusManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30秒缓存
        this.servers = {
            '1': {
                name: '一服 - 生电插件服',
                address: 'play.simpfun.cn:30786',
                description: '插件服，鼓励生电',
                type: 'plugin'
            },
            '2': {
                name: '二服 - 整合包服',
                address: 'play.simpfun.cn:17795',
                description: '整合包服，需下载客户端',
                type: 'modpack'
            }
        };
    }

    // 获取服务器状态
    async getServerStatus(serverAddress) {
        const cached = this.cache.get(serverAddress);
        const now = Date.now();
        
        if (cached && now - cached.timestamp < this.cacheTimeout) {
            return { ...cached.data, fromCache: true };
        }
        
        try {
            const freshData = await this.fetchServerStatus(serverAddress);
            this.cache.set(serverAddress, {
                data: freshData,
                timestamp: now
            });
            
            return { ...freshData, fromCache: false };
        } catch (error) {
            // 如果获取失败，返回缓存数据（如果有）
            if (cached) {
                return { ...cached.data, fromCache: true, error: true };
            }
            throw error;
        }
    }

    // 从API获取服务器状态
    async fetchServerStatus(serverAddress) {
        const response = await fetch(`https://api.mcsrvstat.us/2/${serverAddress}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const processedData = this.processServerData(data);
        
        // 如果服务器在线，测量真实延迟
        if (processedData.online) {
            const realPing = await this.measureRealPing(serverAddress);
            if (realPing !== null) {
                processedData.debug.realPing = realPing;
            }
        }
        
        return processedData;
    }

    // 测量真实延迟（从浏览器ping服务器）
    async measureRealPing(serverAddress) {
        return new Promise((resolve) => {
            const [host, port] = serverAddress.split(':');
            const startTime = performance.now();
            
            // 使用WebSocket连接尝试测量延迟
            const ws = new WebSocket(`ws://${host}:${port}`);
            
            const timeout = setTimeout(() => {
                ws.close();
                resolve(null); // 超时返回null
            }, 5000);
            
            ws.onopen = () => {
                const endTime = performance.now();
                clearTimeout(timeout);
                ws.close();
                resolve(Math.round(endTime - startTime));
            };
            
            ws.onerror = () => {
                clearTimeout(timeout);
                // WebSocket失败，尝试使用Image ping
                this.measureImagePing(host, port).then(resolve).catch(() => resolve(null));
            };
        });
    }

    // 备选方案：使用Image ping测量延迟
    async measureImagePing(host, port) {
        return new Promise((resolve, reject) => {
            const startTime = performance.now();
            const img = new Image();
            
            // 尝试连接服务器图标或favicon
            img.src = `http://${host}:${port}/favicon.ico?t=${Date.now()}`;
            
            const timeout = setTimeout(() => {
                img.onload = img.onerror = null;
                reject(new Error('Image ping timeout'));
            }, 3000);
            
            img.onload = () => {
                clearTimeout(timeout);
                const endTime = performance.now();
                resolve(Math.round(endTime - startTime));
            };
            
            img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Image ping failed'));
            };
        });
    }

    // 处理服务器数据
    processServerData(data) {
        // 处理ping字段，确保显示具体的延迟数值
        let pingValue = data.debug?.ping;
        if (pingValue === true) {
            pingValue = null; // 如果API返回true，设为null
        } else if (typeof pingValue === 'number') {
            pingValue = Math.round(pingValue); // 确保是整数
        } else if (pingValue === false || pingValue === undefined) {
            pingValue = null; // 其他无效值设为null
        }
        
        return {
            online: data.online || false,
            ip: data.ip || '未知',
            port: data.port || '未知',
            hostname: data.hostname || '未知',
            icon: data.icon || null,
            version: data.version || '未知',
            protocol: data.protocol || '未知',
            protocolName: data.protocol_name || '未知',
            players: {
                online: data.players?.online || 0,
                max: data.players?.max || 0,
                list: data.players?.list || []
            },
            motd: {
                raw: data.motd?.raw || [],
                clean: data.motd?.clean || [],
                html: data.motd?.html || []
            },
            debug: {
                ping: pingValue,
                query: data.debug?.query || false,
                cacheHit: data.debug?.cachehit || false
            },
            software: data.software || '未知',
            gamemode: data.gamemode || '生存',
            map: data.map || '未知',
            plugins: data.plugins?.names || []
        };
    }

    // 获取玩家头像URL
    getPlayerAvatarUrl(username) {
        // 优先使用Cravatar，备选Minotar
        const cravatarUrl = `https://cravatar.eu/helmavatar/${username}/64.png`;
        const minotarUrl = `https://minotar.net/avatar/${username}/64.png`;
        
        return cravatarUrl; // 直接返回Cravatar，因为更可靠
    }

    // 渲染MOTD（处理颜色代码）
    renderMOTD(motdHtml) {
        if (!motdHtml || !Array.isArray(motdHtml)) {
            return '';
        }
        
        return motdHtml.map(line => {
            // 处理Minecraft颜色代码 §
            let processedLine = line.replace(/§([0-9a-fk-or])/g, (match, code) => {
                return `</span><span class="mc-color-${code}">`;
            }).replace(/§r/g, '</span><span>');
            
            // 确保有起始span
            if (!processedLine.startsWith('<span')) {
                processedLine = '<span>' + processedLine;
            }
            
            // 确保有结束span
            if (!processedLine.endsWith('</span>')) {
                processedLine = processedLine + '</span>';
            }
            
            return processedLine;
        }).join('<br>');
    }
}

// 主题管理器
class ThemeManager {
    constructor() {
        this.currentTheme = this.getSystemTheme();
        this.init();
    }

    // 获取系统主题偏好
    getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    // 初始化主题
    init() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.currentTheme = savedTheme;
        }
        
        this.applyTheme();
        this.setupEventListeners();
    }

    // 应用主题
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        localStorage.setItem('theme', this.currentTheme);
        
        // 更新主题切换按钮图标
        const themeIcon = document.querySelector('#themeToggle i');
        if (themeIcon) {
            themeIcon.className = this.currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    // 切换主题
    toggleTheme() {
        this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme();
    }

    // 设置事件监听器
    setupEventListeners() {
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // 监听系统主题变化
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('theme')) {
                    this.currentTheme = e.matches ? 'dark' : 'light';
                    this.applyTheme();
                }
            });
        }
    }
}

// Toast通知管理器
class ToastManager {
    constructor() {
        this.container = document.getElementById('toastContainer');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toastContainer';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    // 显示Toast
    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'fas fa-info-circle';
        switch (type) {
            case 'success':
                icon = 'fas fa-check-circle';
                break;
            case 'error':
                icon = 'fas fa-exclamation-circle';
                break;
            case 'warning':
                icon = 'fas fa-exclamation-triangle';
                break;
        }
        
        toast.innerHTML = `
            <i class="${icon}"></i>
            <span>${message}</span>
        `;
        
        this.container.appendChild(toast);
        
        // 自动移除
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
        
        return toast;
    }
}

// 复制管理器
class CopyManager {
    constructor(toastManager) {
        this.toastManager = toastManager;
    }

    // 复制文本到剪贴板
    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toastManager.show('已复制到剪贴板', 'success');
            return true;
        } catch (err) {
            // 降级方案
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.toastManager.show('已复制到剪贴板', 'success');
                return true;
            } catch (fallbackErr) {
                this.toastManager.show('复制失败', 'error');
                return false;
            } finally {
                document.body.removeChild(textArea);
            }
        }
    }
}

// 主应用类
class MinecraftStatusApp {
    constructor() {
        this.statusManager = new ServerStatusManager();
        this.themeManager = new ThemeManager();
        this.toastManager = new ToastManager();
        this.copyManager = new CopyManager(this.toastManager);
        this.isPlayersExpanded = false;
        
        this.init();
    }

    // 初始化应用
    init() {
        this.setupEventListeners();
        this.loadServerStatus();
        this.setupAutoRefresh();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 玩家列表切换
        const togglePlayers = document.getElementById('togglePlayers');
        if (togglePlayers) {
            togglePlayers.addEventListener('click', () => this.togglePlayersList());
        }

        // 玩家搜索
        const playerSearch = document.getElementById('playerSearch');
        if (playerSearch) {
            playerSearch.addEventListener('input', (e) => this.filterPlayers(e.target.value));
        }

        // 自定义服务器检测
        const checkCustom = document.getElementById('checkCustom');
        const customServer = document.getElementById('customServer');
        if (checkCustom && customServer) {
            checkCustom.addEventListener('click', () => this.checkCustomServer());
            customServer.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.checkCustomServer();
                }
            });
        }

        // 复制按钮
        document.addEventListener('click', (e) => {
            if (e.target.closest('.copy-btn')) {
                const address = e.target.closest('.copy-btn').dataset.copy;
                if (address) {
                    this.copyManager.copyText(address);
                }
            }
        });
    }

    // 加载服务器状态
    async loadServerStatus() {
        const serversGrid = document.getElementById('serversGrid');
        if (!serversGrid) return;

        serversGrid.innerHTML = '<div class="loading-spinner" style="grid-column: 1/-1; justify-self: center; margin: 2rem;"></div>';

        try {
            // 并行获取两个服务器的状态
            const [server1Status, server2Status] = await Promise.allSettled([
                this.statusManager.getServerStatus(this.statusManager.servers['1'].address),
                this.statusManager.getServerStatus(this.statusManager.servers['2'].address)
            ]);

            serversGrid.innerHTML = '';
            
            // 渲染服务器1
            if (server1Status.status === 'fulfilled') {
                this.renderServerCard('1', server1Status.value);
            } else {
                console.error('服务器1状态获取失败:', server1Status.reason);
                this.renderServerCard('1', { 
                    online: false, 
                    error: true,
                    players: { online: 0, max: 0, list: [] },
                    motd: { raw: [], clean: [], html: [] },
                    debug: { ping: null, query: false, cacheHit: false }
                });
            }

            // 渲染服务器2
            if (server2Status.status === 'fulfilled') {
                this.renderServerCard('2', server2Status.value);
            } else {
                console.error('服务器2状态获取失败:', server2Status.reason);
                this.renderServerCard('2', { 
                    online: false, 
                    error: true,
                    players: { online: 0, max: 0, list: [] },
                    motd: { raw: [], clean: [], html: [] },
                    debug: { ping: null, query: false, cacheHit: false }
                });
            }

            // 更新玩家列表
            this.updatePlayersList();

        } catch (error) {
            console.error('加载服务器状态失败:', error);
            serversGrid.innerHTML = '<div class="error" style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--error);">加载服务器状态失败，请稍后重试</div>';
        }
    }

    // 渲染服务器卡片
    renderServerCard(serverId, status) {
        const server = this.statusManager.servers[serverId];
        const serversGrid = document.getElementById('serversGrid');
        
        const card = document.createElement('div');
        card.className = 'server-card';
        card.innerHTML = this.generateServerCardHTML(server, status);
        
        serversGrid.appendChild(card);
    }

    // 生成服务器卡片HTML
    generateServerCardHTML(server, status) {
        const isOnline = status.online && !status.error;
        const playerCount = isOnline ? `${status.players.online}/${status.players.max}` : '--/--';
        const latency = isOnline ? (status.debug.ping ? `${status.debug.ping}ms` : '< 100ms') : '--';
        const version = isOnline ? status.version : '--';
        
        let motdHTML = '';
        if (isOnline && status.motd.html) {
            motdHTML = this.statusManager.renderMOTD(status.motd.html);
        }

        let cacheIndicator = '';
        if (status.fromCache) {
            cacheIndicator = '<span class="cache-indicator" style="font-size: 0.7rem; color: var(--neutral-500); margin-left: 0.5rem;">(缓存)</span>';
        }

        return `
            <div class="server-header">
                ${status.icon ? `<img class="server-icon" src="${status.icon}" alt="服务器图标">` : '<div class="server-icon" style="background: var(--neutral-200); display: flex; align-items: center; justify-content: center;"><i class="fas fa-server" style="color: var(--neutral-500);"></i></div>'}
                <div class="server-info">
                    <h3>${server.name}</h3>
                    <div class="server-address">
                        <code>${server.address}</code>
                        <button class="copy-btn" data-copy="${server.address}" title="复制地址">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="status-indicator ${isOnline ? 'online' : 'offline'}">
                <div class="status-dot"></div>
                <span>${isOnline ? '在线' : status.error ? '检测失败' : '离线'}</span>
                <span class="player-count">${playerCount}${cacheIndicator}</span>
            </div>
            
            <div class="server-stats">
                <div class="stat">
                    <span class="label">延迟</span>
                    <span class="value">${latency}</span>
                </div>
                <div class="stat">
                    <span class="label">版本</span>
                    <span class="value">${version}</span>
                </div>
            </div>
            
            ${motdHTML ? `
            <div class="motd-display">
                ${motdHTML}
            </div>
            ` : ''}
            
            ${server.description ? `
            <div style="margin-top: 1rem; font-size: 0.9rem; color: var(--neutral-600);">
                <i class="fas fa-info-circle"></i> ${server.description}
            </div>
            ` : ''}
        `;
    }

    // 更新玩家列表
    updatePlayersList() {
        const playersGrid = document.getElementById('playersGrid');
        const noPlayers = document.getElementById('noPlayers');
        
        if (!playersGrid || !noPlayers) return;

        // 获取所有在线玩家
        let allPlayers = [];
        Object.values(this.statusManager.servers).forEach(server => {
            const cached = this.statusManager.cache.get(server.address);
            if (cached && cached.data.online && cached.data.players.list) {
                allPlayers = [...allPlayers, ...cached.data.players.list];
            }
        });

        playersGrid.innerHTML = '';
        
        if (allPlayers.length === 0) {
            noPlayers.style.display = 'block';
            playersGrid.style.display = 'none';
        } else {
            noPlayers.style.display = 'none';
            playersGrid.style.display = 'grid';
            
            allPlayers.forEach(player => {
                const playerCard = document.createElement('div');
                playerCard.className = 'player-card';
                playerCard.innerHTML = `
                    <img class="player-avatar" src="${this.statusManager.getPlayerAvatarUrl(player)}" alt="${player}" loading="lazy">
                    <span class="player-name">${player}</span>
                    <span class="player-playtime">在线</span>
                `;
                playersGrid.appendChild(playerCard);
            });
        }
    }

    // 切换玩家列表显示
    togglePlayersList() {
        const playersContainer = document.getElementById('playersContainer');
        const toggleBtn = document.getElementById('togglePlayers');
        const toggleText = toggleBtn.querySelector('span');
        const toggleIcon = toggleBtn.querySelector('i');
        
        this.isPlayersExpanded = !this.isPlayersExpanded;
        
        if (this.isPlayersExpanded) {
            playersContainer.classList.remove('collapsed');
            toggleText.textContent = '收起';
            toggleIcon.className = 'fas fa-chevron-up';
        } else {
            playersContainer.classList.add('collapsed');
            toggleText.textContent = '展开';
            toggleIcon.className = 'fas fa-chevron-down';
        }
    }

    // 过滤玩家
    filterPlayers(searchTerm) {
        const playerCards = document.querySelectorAll('.player-card');
        const noPlayers = document.getElementById('noPlayers');
        
        let visibleCount = 0;
        
        playerCards.forEach(card => {
            const playerName = card.querySelector('.player-name').textContent.toLowerCase();
            if (playerName.includes(searchTerm.toLowerCase())) {
                card.style.display = 'block';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });
        
        if (visibleCount === 0 && searchTerm) {
            noPlayers.style.display = 'block';
            noPlayers.innerHTML = '<i class="fas fa-search"></i><p>未找到匹配的玩家</p>';
        } else if (visibleCount === 0) {
            noPlayers.style.display = 'block';
            noPlayers.innerHTML = '<i class="fas fa-users-slash"></i><p>当前没有玩家在线</p>';
        } else {
            noPlayers.style.display = 'none';
        }
    }

    // 检测自定义服务器
    async checkCustomServer() {
        const customServerInput = document.getElementById('customServer');
        const checkResult = document.getElementById('customResult');
        const checkBtn = document.getElementById('checkCustom');
        
        if (!customServerInput || !checkResult || !checkBtn) return;
        
        const serverAddress = customServerInput.value.trim();
        if (!serverAddress) {
            this.toastManager.show('请输入服务器地址', 'warning');
            return;
        }
        
        // 禁用按钮并显示加载状态
        const originalText = checkBtn.innerHTML;
        checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 检测中...';
        checkBtn.disabled = true;
        
        try {
            const status = await this.statusManager.getServerStatus(serverAddress);
            
            let resultHTML = '';
            if (status.online) {
                const motdHTML = this.statusManager.renderMOTD(status.motd.html);
                resultHTML = `
                    <div class="custom-result success">
                        <div class="result-header">
                            <i class="fas fa-check-circle"></i>
                            <h4>服务器在线</h4>
                        </div>
                        <div class="result-details">
                            <div class="detail">
                                <span class="label">地址:</span>
                                <span class="value">${status.hostname || status.ip}:${status.port}</span>
                            </div>
                            <div class="detail">
                                <span class="label">版本:</span>
                                <span class="value">${status.version}</span>
                            </div>
                            <div class="detail">
                                <span class="label">玩家:</span>
                                <span class="value">${status.players.online}/${status.players.max}</span>
                            </div>
                            <div class="detail">
                                <span class="label">延迟:</span>
                                <span class="value">${status.debug.ping ? status.debug.ping + 'ms' : '< 100ms'}</span>
                            </div>
                            ${motdHTML ? `
                            <div class="detail motd">
                                <span class="label">MOTD:</span>
                                <div class="value motd-content">${motdHTML}</div>
                            </div>
                            ` : ''}
                        </div>
                        ${status.fromCache ? '<div class="cache-note">数据来自缓存</div>' : ''}
                    </div>
                `;
            } else {
                resultHTML = `
                    <div class="custom-result error">
                        <div class="result-header">
                            <i class="fas fa-times-circle"></i>
                            <h4>服务器离线</h4>
                        </div>
                        <div class="result-details">
                            <p>无法连接到服务器，请检查地址是否正确或服务器是否正在维护。</p>
                        </div>
                    </div>
                `;
            }
            
            checkResult.innerHTML = resultHTML;
            checkResult.style.display = 'block';
            
        } catch (error) {
            console.error('检测自定义服务器失败:', error);
            checkResult.innerHTML = `
                <div class="custom-result error">
                    <div class="result-header">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h4>检测失败</h4>
                    </div>
                    <div class="result-details">
                        <p>无法获取服务器状态，请检查网络连接或稍后重试。</p>
                    </div>
                </div>
            `;
            checkResult.style.display = 'block';
        } finally {
            // 恢复按钮状态
            checkBtn.innerHTML = originalText;
            checkBtn.disabled = false;
        }
    }

    // 设置自动刷新
    setupAutoRefresh() {
        // 每30秒自动刷新状态
        setInterval(() => {
            this.loadServerStatus();
        }, 30000);
        
        // 监听页面可见性变化，当页面重新可见时刷新
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.loadServerStatus();
            }
        });
    }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new MinecraftStatusApp();
});

// 导出类供测试使用（如果需要在控制台调试）
window.MinecraftStatusApp = MinecraftStatusApp;
window.ServerStatusManager = ServerStatusManager;
