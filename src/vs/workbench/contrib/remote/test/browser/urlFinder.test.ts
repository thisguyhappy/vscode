/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { UrlFinder } from '../../browser/urlFinder.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { IDebugService } from '../../../debug/common/debug.js';

// Mock implementations for testing
class MockTerminalInstance implements Partial<ITerminalInstance>, IDisposable {
	private readonly _onData = new Emitter<string>();
	readonly onData = this._onData.event;
	readonly title = 'test-terminal';

	fireData(data: string): void {
		this._onData.fire(data);
	}

	dispose(): void {
		this._onData.dispose();
	}
}

suite('UrlFinder', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function createMockTerminalService(instances: ITerminalInstance[], localStore: DisposableStore): ITerminalService {
		const onDidCreateInstance = localStore.add(new Emitter<ITerminalInstance>());
		const onDidDisposeInstance = localStore.add(new Emitter<ITerminalInstance>());
		return {
			instances,
			onDidCreateInstance: onDidCreateInstance.event,
			onDidDisposeInstance: onDidDisposeInstance.event,
		} as unknown as ITerminalService;
	}

	function createMockDebugService(localStore: DisposableStore): IDebugService {
		const onDidNewSession = localStore.add(new Emitter<never>());
		const onDidEndSession = localStore.add(new Emitter<never>());
		return {
			onDidNewSession: onDidNewSession.event,
			onDidEndSession: onDidEndSession.event,
		} as unknown as IDebugService;
	}

	test('should find localhost URLs', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Include newline to simulate actual process output
		mockInstance.fireData('Server running at http://localhost:3000/\n');

		assert.strictEqual(matchedUrls.length, 1);
		assert.strictEqual(matchedUrls[0].host, 'localhost');
		assert.strictEqual(matchedUrls[0].port, 3000);
	});

	test('should find 127.0.0.1 URLs', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Include newline to simulate actual process output
		mockInstance.fireData('https://127.0.0.1:5001/api\n');

		assert.strictEqual(matchedUrls.length, 1);
		assert.strictEqual(matchedUrls[0].host, '127.0.0.1');
		assert.strictEqual(matchedUrls[0].port, 5001);
	});

	test('should find 0.0.0.0 URLs', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Include newline to simulate actual process output
		mockInstance.fireData('http://0.0.0.0:4000\n');

		assert.strictEqual(matchedUrls.length, 1);
		assert.strictEqual(matchedUrls[0].host, '0.0.0.0');
		assert.strictEqual(matchedUrls[0].port, 4000);
	});

	test('should skip processing for large data chunks (> 2KB)', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Create a large data chunk (> 2KB) with a URL embedded and a newline
		const largeData = 'x'.repeat(2001) + 'http://localhost:3000/' + 'x'.repeat(100) + '\n';
		mockInstance.fireData(largeData);

		// URL should not be detected because data is too large
		assert.strictEqual(matchedUrls.length, 0, 'URLs should not be detected in large data chunks');
	});

	test('should process data chunks under threshold', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Create a data chunk under 2KB with a URL and newline
		const normalData = 'Server started at http://localhost:8080/\n';
		mockInstance.fireData(normalData);

		assert.strictEqual(matchedUrls.length, 1, 'URLs should be detected in normal-sized data chunks');
		assert.strictEqual(matchedUrls[0].port, 8080);
	});

	test('should rate limit when too many events occur', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Fire more than 50 events rapidly (rate limit is 50 per second)
		// Include newlines to ensure data is processed
		for (let i = 0; i < 60; i++) {
			mockInstance.fireData(`http://localhost:${3000 + i}/\n`);
		}

		// Should have rate limited after 50 events
		assert.ok(matchedUrls.length <= 50, `Should rate limit to 50 events, got ${matchedUrls.length}`);
	});

	test('should not match IP addresses without ports', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// IP address without port should not be matched (not a valid URL)
		// Include newline so data is processed
		mockInstance.fireData('Connected to 127.0.0.1\n');

		assert.strictEqual(matchedUrls.length, 0, 'IP addresses without ports should not be matched');
	});

	test('should not match invalid ports', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Port 0 is invalid (include newline)
		mockInstance.fireData('http://localhost:0/\n');
		// Port > 65535 is invalid (include newline)
		mockInstance.fireData('http://localhost:70000/\n');

		assert.strictEqual(matchedUrls.length, 0, 'Invalid ports should not be matched');
	});

	test('should handle multiple URLs in same data chunk', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Include newline to simulate actual process output
		mockInstance.fireData('Server A at http://localhost:3000/ and Server B at http://localhost:4000/\n');

		assert.strictEqual(matchedUrls.length, 2);
		assert.strictEqual(matchedUrls[0].port, 3000);
		assert.strictEqual(matchedUrls[1].port, 4000);
	});

	test('should not process data without newlines (user typing)', () => {
		const store = ds.add(new DisposableStore());
		const mockInstance = store.add(new MockTerminalInstance());
		const terminalService = createMockTerminalService([mockInstance as unknown as ITerminalInstance], store);
		const debugService = createMockDebugService(store);

		const urlFinder = store.add(new UrlFinder(terminalService, debugService));

		const matchedUrls: { host: string; port: number }[] = [];
		store.add(urlFinder.onDidMatchLocalUrl((url: { host: string; port: number }) => matchedUrls.push(url)));

		// Simulate user typing - no newline, so this should not be processed
		mockInstance.fireData('http://localhost:3000/');

		assert.strictEqual(matchedUrls.length, 0, 'URLs without newlines should not be detected (user typing)');
	});
});
