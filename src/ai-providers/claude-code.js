import { execSync } from 'child_process';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import { log } from '../../scripts/modules/index.js';
import { BaseAIProvider } from './base-provider.js';

/**
 * Claude Code CLI provider implementation
 * Uses ai-sdk-provider-claude-code to integrate with Claude through the Claude Code CLI
 */
export class ClaudeCodeProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'ClaudeCode';
		this.supportedModels = ['opus', 'sonnet'];
	}

	/**
	 * Checks if Claude Code CLI is installed and accessible
	 */
	checkCLIInstallation() {
		try {
			execSync('claude --version', { encoding: 'utf8' });
			return true;
		} catch (error) {
			log(
				'warn',
				'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
			);
			return false;
		}
	}

	/**
	 * Override to handle SDK authentication errors properly
	 */
	async handleError(operation, error) {
		const errorMessage = error.message?.toLowerCase() || '';

		// Check for authentication errors
		if (
			errorMessage.includes('not authenticated') ||
			errorMessage.includes('auth_required') ||
			error.code === 'AUTH_REQUIRED'
		) {
			throw new Error('Claude Code authentication required. Run: claude login');
		}

		// Check for CLI not found errors
		if (
			errorMessage.includes('command not found') ||
			errorMessage.includes('enoent') ||
			errorMessage.includes('spawn claude')
		) {
			throw new Error(
				'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
			);
		}

		// Check for timeout errors
		if (errorMessage.includes('timeout') || error.code === 'TIMEOUT') {
			throw new Error(
				'Request timed out. Increase timeoutMs in config.json (default: 120000ms, max: 600000ms)'
			);
		}

		// For other errors, use base class handling
		super.handleError(operation, error);
	}

	/**
	 * Override validateAuth to skip API key requirement
	 * Claude Code uses CLI authentication instead
	 */
	validateAuth(params) {
		// No API key needed for Claude Code CLI
		log('debug', 'Claude Code provider uses CLI authentication');
	}

	/**
	 * Override validateParams to add model validation
	 */
	validateParams(params) {
		super.validateParams(params);

		if (!this.supportedModels.includes(params.modelId)) {
			throw new Error(
				`Model '${params.modelId}' is not supported. ` +
					`Supported models: ${this.supportedModels.join(', ')}`
			);
		}
	}

	/**
	 * Creates and returns a Claude Code client instance
	 */
	getClient(params) {
		const config = {
			timeoutMs: params.timeoutMs || 120000,
			skipPermissions: params.skipPermissions || false,
			maxConcurrentProcesses: params.maxConcurrentProcesses || 4,
			cliPath: params.cliPath || 'claude'
		};

		try {
			const client = createClaudeCode(config);

			// Return a wrapped client that passes config to each model
			return (modelId) => {
				return client(modelId, config);
			};
		} catch (error) {
			throw error;
		}
	}

	/**
	 * Override generateText to check CLI installation
	 */
	async generateText(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.generateText(params);
	}

	/**
	 * Override streamText to check CLI installation
	 */
	async streamText(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.streamText(params);
	}

	/**
	 * Override generateObject to check CLI installation
	 */
	async generateObject(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.generateObject(params);
	}
}
