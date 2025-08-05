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
        });
    }

    switchAuthTab(tabName) {
        // Update active tab
        this.activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }
}

// Create global UITabs instance
window.UITabs = new UITabs();