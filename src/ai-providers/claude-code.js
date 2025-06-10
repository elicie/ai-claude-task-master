import { BaseAIProvider } from './base-provider.js';
import { log } from '../../scripts/modules/index.js';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import { execSync } from 'child_process';

/**
 * Claude Code CLI provider implementation
 * Uses ai-sdk-provider-claude-code to integrate with Claude through the Claude Code CLI
 */
export class ClaudeCodeProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'ClaudeCode';

		// Define supported models
		this.supportedModels = ['opus', 'sonnet'];

		// Check if Claude Code CLI is installed on initialization
		this.cliInstalled = null; // Cache the installation status
	}

	/**
	 * Checks if Claude Code CLI is installed and accessible
	 */
	checkCLIInstallation() {
		// Return cached result if available
		if (this.cliInstalled !== null) {
			log(
				'debug',
				`Claude Code CLI installation check (cached): ${this.cliInstalled}`
			);
			return this.cliInstalled;
		}

		try {
			log('debug', 'Checking Claude Code CLI installation...');
			// Try to run claude --version to check if CLI is installed
			const version = execSync('claude --version', { encoding: 'utf8' }).trim();
			log('info', `Claude Code CLI detected: ${version}`);
			this.cliInstalled = true;
			return true;
		} catch (error) {
			log('debug', 'Claude Code CLI check failed', {
				errorCode: error.code,
				errorMessage: error.message,
				command: 'claude --version'
			});
			log(
				'warn',
				'Claude Code CLI not found on system.\n' +
					'To use the claude-code provider, install it with:\n' +
					'  npm install -g @anthropic-ai/claude-code\n' +
					'Then authenticate with:\n' +
					'  claude login'
			);
			// We don't throw here to allow the provider to be registered
			// The error will be thrown when actually trying to use it
			this.cliInstalled = false;
			return false;
		}
	}

	/**
	 * Check if an error is retryable
	 */
	isRetryableError(error) {
		const errorMessage = error.message?.toLowerCase() || '';
		const errorCode = error.code?.toLowerCase() || '';

		// Claude Code specific retryable conditions
		return (
			// CLI process spawn failures that might be transient
			errorMessage.includes('spawn') ||
			errorMessage.includes('epipe') ||
			errorMessage.includes('sigterm') ||
			errorMessage.includes('sigkill') ||
			// Network issues
			errorMessage.includes('econnreset') ||
			errorMessage.includes('socket hang up') ||
			errorMessage.includes('network') ||
			// Rate limits or temporary failures
			errorMessage.includes('rate limit') ||
			errorMessage.includes('overloaded') ||
			errorMessage.includes('temporarily unavailable') ||
			// Process/resource issues
			errorCode === 'eagain' ||
			errorCode === 'emfile' ||
			errorCode === 'enfile'
		);
	}

	/**
	 * Wrap operations with retry logic for transient failures
	 */
	async withRetry(operation, fn, maxRetries = 3) {
		let lastError;
		const baseDelay = 1000; // 1 second

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;

				// Check if error is retryable and we have retries left
				if (this.isRetryableError(error) && attempt < maxRetries) {
					const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
					log('debug', `${operation} retry check`, {
						attempt: attempt + 1,
						maxRetries: maxRetries + 1,
						delay,
						errorCode: error.code,
						errorType: error.constructor.name
					});
					log(
						'warn',
						`${operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
							`retrying in ${delay}ms: ${error.message}`
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				} else {
					// Not retryable or out of retries
					log('debug', `${operation} not retryable or max retries reached`, {
						isRetryable: this.isRetryableError(error),
						attempt: attempt + 1,
						maxRetries: maxRetries + 1
					});
					break;
				}
			}
		}

		// If we get here, all retries failed
		throw lastError;
	}

	/**
	 * Override to handle SDK authentication errors properly
	 * The SDK will throw authentication errors that we need to catch and re-throw with better messages
	 */
	async handleError(operation, error) {
		log('debug', `Claude Code ${operation} error`, {
			errorType: error.constructor.name,
			errorCode: error.code,
			errorMessage: error.message,
			operation
		});

		// Check for authentication-related errors from the SDK
		if (
			error.message?.includes('not authenticated') ||
			error.message?.includes('AUTH_REQUIRED') ||
			error.message?.includes('authentication') ||
			error.message?.includes('unauthorized') ||
			error.message?.includes('session expired') ||
			error.message?.includes('invalid token') ||
			error.message?.includes('login required') ||
			error.message?.includes('please authenticate') ||
			error.code === 'AUTH_REQUIRED' ||
			error.code === 'UNAUTHORIZED' ||
			error.status === 401
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Claude Code Authentication Required\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'You need to authenticate with Claude Code to use this provider.\n' +
					'\n' +
					'To authenticate:\n' +
					'  claude login\n' +
					'\n' +
					'This will open your browser to complete the authentication.\n' +
					'After authenticating, try your command again.\n' +
					'\n' +
					'If you were previously logged in, your session may have expired.\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// Check for CLI not found errors
		if (
			error.message?.includes('command not found') ||
			error.message?.includes('ENOENT') ||
			error.message?.includes('not found') ||
			error.message?.includes('spawn claude')
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Claude Code CLI Not Found\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'The Claude Code CLI is required but not installed on your system.\n' +
					'\n' +
					'To fix this issue:\n' +
					'\n' +
					'1. Install Claude Code CLI globally:\n' +
					'   npm install -g @anthropic-ai/claude-code\n' +
					'\n' +
					'2. Verify installation:\n' +
					'   claude --version\n' +
					'\n' +
					'3. Authenticate with your Claude account:\n' +
					'   claude login\n' +
					'\n' +
					'For more information, visit:\n' +
					'https://github.com/anthropics/claude-code\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// Check for PATH or permission issues
		if (
			error.message?.includes('EACCES') ||
			error.message?.includes('permission denied')
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Permission Error\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'Claude Code CLI exists but cannot be executed due to permissions.\n' +
					'\n' +
					'To fix this issue:\n' +
					'\n' +
					'1. Check file permissions:\n' +
					'   ls -la $(which claude)\n' +
					'\n' +
					'2. If needed, fix permissions:\n' +
					'   chmod +x $(which claude)\n' +
					'\n' +
					'3. Or reinstall with proper permissions:\n' +
					'   sudo npm install -g @anthropic-ai/claude-code\n' +
					'\n' +
					'4. After fixing permissions, authenticate:\n' +
					'   claude login\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// Check for timeout errors
		if (
			error.message?.includes('timeout') ||
			error.message?.includes('ETIMEDOUT') ||
			error.message?.includes('timed out') ||
			error.code === 'ETIMEDOUT' ||
			error.code === 'TIMEOUT'
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Request Timeout\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'The request to Claude timed out. This can happen with complex\n' +
					'queries or when Claude needs more time to think.\n' +
					'\n' +
					'To fix this issue:\n' +
					'\n' +
					'1. For complex tasks, increase the timeout in .taskmaster/config.json:\n' +
					'   "claudeCode": {\n' +
					'     "timeoutMs": 300000  // 5 minutes\n' +
					'   }\n' +
					'\n' +
					'2. For very long tasks (up to 10 minutes):\n' +
					'   "claudeCode": {\n' +
					'     "timeoutMs": 600000  // 10 minutes\n' +
					'   }\n' +
					'\n' +
					'3. Try breaking down complex requests into smaller parts\n' +
					'\n' +
					'4. Check your internet connection stability\n' +
					'\n' +
					'Note: Claude Opus 4 may require longer timeouts for complex\n' +
					'reasoning tasks. The default is 2 minutes (120000ms).\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// Check for network/connection errors
		if (
			error.message?.includes('ECONNREFUSED') ||
			error.message?.includes('ECONNRESET') ||
			error.message?.includes('ENOTFOUND') ||
			error.message?.includes('network') ||
			error.message?.includes('socket hang up') ||
			error.code === 'ECONNREFUSED' ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Network Connection Error\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'Unable to connect to Claude servers. This may be due to:\n' +
					'\n' +
					'1. Internet connectivity issues\n' +
					'2. Firewall or proxy blocking the connection\n' +
					'3. Claude service temporarily unavailable\n' +
					'\n' +
					'To troubleshoot:\n' +
					'\n' +
					'1. Check your internet connection:\n' +
					'   ping anthropic.com\n' +
					'\n' +
					'2. Verify Claude CLI can connect:\n' +
					'   claude --version\n' +
					'\n' +
					'3. If behind a corporate firewall, configure proxy:\n' +
					'   export HTTPS_PROXY=http://your-proxy:port\n' +
					'\n' +
					'4. Try again in a few moments if the service is down\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// Check for generic permission/access errors that might be auth-related
		if (
			error.message?.includes('access denied') ||
			error.message?.includes('forbidden') ||
			error.message?.includes('not authorized') ||
			error.status === 403
		) {
			throw new Error(
				'═══════════════════════════════════════════════════════════════\n' +
					'  Access Denied\n' +
					'═══════════════════════════════════════════════════════════════\n' +
					'\n' +
					'Claude Code denied access to this operation. This could mean:\n' +
					'\n' +
					'1. Your authentication has expired:\n' +
					'   claude login\n' +
					'\n' +
					"2. Your account doesn't have access to this model\n" +
					'\n' +
					'3. Rate limits or usage limits have been exceeded\n' +
					'\n' +
					'Try running "claude login" to refresh your authentication.\n' +
					'═══════════════════════════════════════════════════════════════'
			);
		}

		// For other errors, use the base class error handling but add auth hint
		const originalError = error.message || error.toString();
		const enhancedError = new Error(
			originalError +
				'\n\nIf this appears to be an authentication issue, try running:\n' +
				'  claude login'
		);
		super.handleError(operation, enhancedError);
	}

	/**
	 * Override validateAuth to skip API key requirement
	 * Claude Code uses CLI authentication instead
	 */
	validateAuth(params) {
		// No API key needed for Claude Code CLI
		// Authentication is handled by the CLI itself
		log('debug', 'Claude Code provider uses CLI authentication');
	}

	/**
	 * Override validateParams to add model validation
	 */
	validateParams(params) {
		// Call parent validation (skips API key check due to our validateAuth override)
		super.validateParams(params);

		// Validate model is supported
		if (!this.supportedModels.includes(params.modelId)) {
			throw new Error(
				`Model '${params.modelId}' is not supported by Claude Code CLI. ` +
					`Supported models are: ${this.supportedModels.join(', ')}`
			);
		}
	}

	/**
	 * Creates and returns a Claude Code client instance
	 */
	getClient(params) {
		// Extract Claude Code specific configuration from params
		const config = {
			timeoutMs: params.timeoutMs || 120000,
			skipPermissions: params.skipPermissions || false,
			maxConcurrentProcesses: params.maxConcurrentProcesses || 4,
			cliPath: params.cliPath || 'claude'
		};

		log('debug', `Creating Claude Code client with config:`, config);

		try {
			// Create and return a new Claude Code client with the configuration
			// The SDK will handle authentication checks and throw appropriate errors
			const client = createClaudeCode(config);
			log('debug', 'Claude Code client created successfully');
			return client;
		} catch (error) {
			log('debug', 'Failed to create Claude Code client', {
				config,
				errorType: error.constructor.name,
				errorCode: error.code
			});
			throw error;
		}
	}

	/**
	 * Override generateText to add retry logic for Claude Code specific failures
	 */
	async generateText(params) {
		return this.withRetry('generateText', async () => {
			log('debug', 'Claude Code generateText called', {
				modelId: params.modelId,
				messageCount: params.messages?.length,
				maxTokens: params.maxTokens,
				temperature: params.temperature
			});

			// First check if CLI is installed
			if (!this.checkCLIInstallation()) {
				const error = new Error('Claude Code CLI is not installed');
				log('error', 'Claude Code generateText failed: CLI not installed');
				throw error;
			}

			// Call parent implementation
			return super.generateText(params);
		});
	}

	/**
	 * Override streamText to add retry logic for Claude Code specific failures
	 */
	async streamText(params) {
		return this.withRetry('streamText', async () => {
			log('debug', 'Claude Code streamText called', {
				modelId: params.modelId,
				messageCount: params.messages?.length,
				maxTokens: params.maxTokens,
				temperature: params.temperature
			});

			// First check if CLI is installed
			if (!this.checkCLIInstallation()) {
				const error = new Error('Claude Code CLI is not installed');
				log('error', 'Claude Code streamText failed: CLI not installed');
				throw error;
			}

			// Call parent implementation
			return super.streamText(params);
		});
	}

	/**
	 * Override generateObject to add retry logic for Claude Code specific failures
	 * The updated ai-sdk-provider-claude-code now supports object generation
	 */
	async generateObject(params) {
		return this.withRetry('generateObject', async () => {
			log('debug', 'Claude Code generateObject called', {
				modelId: params.modelId,
				schemaName: params.output?.name,
				hasSchema: !!params.output?.schema,
				maxTokens: params.maxTokens,
				temperature: params.temperature
			});

			// First check if CLI is installed
			if (!this.checkCLIInstallation()) {
				const error = new Error('Claude Code CLI is not installed');
				log('error', 'Claude Code generateObject failed: CLI not installed');
				throw error;
			}

			// Call parent implementation which will use the SDK's generateObject support
			return super.generateObject(params);
		});
	}
}
