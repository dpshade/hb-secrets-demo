/**
 * UI Tab Management
 * Handles switching between auth method tabs
 */
class UITabs {
    constructor() {
        this.activeTab = 'generate';
        this.init();
    }

    init() {
        this.bindTabEvents();
        console.log('UI Tabs initialized');
    }

    bindTabEvents() {
        // Auth tab switching
        const authTabs = document.querySelectorAll('.auth-tab');
        authTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.getAttribute('data-tab');
                this.switchAuthTab(tabName);
            });
            
            // Keyboard navigation support
            tab.addEventListener('keydown', (e) => {
                const tabName = e.target.getAttribute('data-tab');
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.switchAuthTab(tabName);
                }
            });
        });

        // Storage option switching
        const storageTabs = document.querySelectorAll('.storage-tab');
        storageTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const persistMode = e.target.closest('.storage-tab').getAttribute('data-persist');
                this.switchStorageTab(persistMode);
            });
        });
    }

    switchAuthTab(tabName) {
        // Update active tab
        this.activeTab = tabName;

        // Update tab buttons with accessibility attributes
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');
        });
        
        const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
        activeTab.classList.add('active');
        activeTab.setAttribute('aria-selected', 'true');
        activeTab.setAttribute('tabindex', '0');

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // Load wallets when switching to wallets tab
        if (tabName === 'wallets' && window.Auth && window.Auth.loadWallets) {
            window.Auth.loadWallets();
        }
    }

    switchStorageTab(persistMode) {
        // Update storage tab buttons
        document.querySelectorAll('.storage-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
        
        const activeStorageTab = document.querySelector(`[data-persist="${persistMode}"]`);
        if (activeStorageTab) {
            activeStorageTab.classList.add('active');
            activeStorageTab.setAttribute('aria-selected', 'true');
        }

        // Update storage description
        document.querySelectorAll('.storage-desc-content').forEach(desc => {
            desc.classList.add('hidden');
        });
        
        const activeDesc = document.querySelector(`.storage-desc-content[data-persist="${persistMode}"]`);
        if (activeDesc) {
            activeDesc.classList.remove('hidden');
        }
    }
}

// Create global UITabs instance
window.UITabs = new UITabs();