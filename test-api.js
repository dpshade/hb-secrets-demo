#!/usr/bin/env bun

/**
 * Test script to verify HyperBEAM API integration
 * Run with: bun test-api.js
 */

// Simple test configuration
const CONFIG = {
    HYPERBEAM_NODE: 'http://localhost:10000',
    ENDPOINTS: {
        SECRET_GENERATE: '/~secret@1.0/generate/json',
        SECRET_LIST: '/~secret@1.0/list/json',
        META_INFO: '/~meta@1.0/info'
    },
    DEFAULT_ACCESS_CONTROL: { device: 'cookie@1.0' }
};

class HyperBEAMAPITest {
    constructor() {
        this.baseUrl = CONFIG.HYPERBEAM_NODE;
        this.timeout = 10000;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        config.signal = controller.signal;

        try {
            console.log(`🔄 Testing: ${config.method} ${url}`);
            
            const response = await fetch(url, config);
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`✅ Success: ${config.method} ${endpoint}`);
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            console.log(`❌ Failed: ${config.method} ${endpoint} - ${error.message}`);
            throw error;
        }
    }

    async testHealthCheck() {
        console.log('\n📡 Testing HyperBEAM Node Health...');
        try {
            const response = await this.request(CONFIG.ENDPOINTS.META_INFO);
            console.log('✅ HyperBEAM node is accessible');
            return true;
        } catch (error) {
            console.log('❌ HyperBEAM node health check failed');
            return false;
        }
    }

    async testWalletGeneration() {
        console.log('\n🔐 Testing Wallet Generation...');
        try {
            const body = {
                persist: 'in-memory',
                'access-control': CONFIG.DEFAULT_ACCESS_CONTROL
            };

            const response = await this.request(CONFIG.ENDPOINTS.SECRET_GENERATE, {
                method: 'POST',
                body: JSON.stringify(body)
            });

            if (response.body || response.keyid) {
                console.log('✅ Wallet generation successful');
                console.log(`   KeyID: ${response.body || response.keyid}`);
                return response;
            } else {
                throw new Error('Invalid wallet generation response');
            }
        } catch (error) {
            console.log('❌ Wallet generation failed');
            return null;
        }
    }

    async testWalletListing() {
        console.log('\n📋 Testing Wallet Listing...');
        try {
            const response = await this.request(CONFIG.ENDPOINTS.SECRET_LIST);
            console.log('✅ Wallet listing successful');
            console.log(`   Found ${Array.isArray(response) ? response.length : 'unknown'} wallets`);
            return response;
        } catch (error) {
            console.log('❌ Wallet listing failed');
            return null;
        }
    }

    parseCookies(response) {
        const cookies = {};
        
        if (response && response.priv && response.priv.cookie) {
            Object.entries(response.priv.cookie).forEach(([key, value]) => {
                cookies[key] = value;
            });
        }
        
        return cookies;
    }

    async runTests() {
        console.log('🧪 HyperBEAM Chat API Integration Test');
        console.log(`🎯 Target Node: ${this.baseUrl}`);
        console.log('═'.repeat(50));

        let passed = 0;
        let total = 0;

        // Test 1: Health Check
        total++;
        if (await this.testHealthCheck()) {
            passed++;
        }

        // Test 2: Wallet Generation
        total++;
        const walletResponse = await this.testWalletGeneration();
        if (walletResponse) {
            passed++;
            
            // Test cookie parsing
            const cookies = this.parseCookies(walletResponse);
            console.log(`   Cookies extracted: ${Object.keys(cookies).length} keys`);
        }

        // Test 3: Wallet Listing
        total++;
        if (await this.testWalletListing()) {
            passed++;
        }

        // Results
        console.log('\n' + '═'.repeat(50));
        console.log(`📊 Test Results: ${passed}/${total} passed`);
        
        if (passed === total) {
            console.log('🎉 All tests passed! HyperBEAM integration is working correctly.');
            process.exit(0);
        } else {
            console.log('⚠️  Some tests failed. Check your HyperBEAM node configuration.');
            process.exit(1);
        }
    }
}

// Run tests
const tester = new HyperBEAMAPITest();
tester.runTests().catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
});