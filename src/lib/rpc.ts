// src/lib/rpc.ts - Robust Transmission RPC client for FlutVierTransmission

let sessionId = '';

export interface RpcRequest {
  method: string;
  arguments?: Record<string, unknown>;
  tag?: number;
}

export interface RpcResponse<T = unknown> {
  result: 'success' | string;
  arguments: T;
  tag?: number;
}

export async function callRpc<T = unknown>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const url = import.meta.env.VITE_TRANSMISSION_RPC_URL ?? '/transmission/rpc';

  const body: RpcRequest = {
    method,
    arguments: args // always include arguments key (even if empty object)
  };

  const makeRequest = async (sid?: string) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (sid) headers['X-Transmission-Session-Id'] = sid;

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body) // clean stringify, no extra whitespace issues
    });
  };

  let res = await makeRequest(sessionId);

  // Handle 409 - get new session ID and retry **once**
  if (res.status === 409) {
    sessionId = res.headers.get('X-Transmission-Session-Id') || '';

    if (!sessionId) {
      throw new Error('Failed to get Transmission session ID');
    }

    // Retry with the fresh session ID
    res = await makeRequest(sessionId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'No response body');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data: RpcResponse<T> = await res.json();

  if (data.result !== 'success') {
    throw new Error(data.result || 'Unknown RPC error from Transmission');
  }

  return data.arguments;
}

// Helper to ensure session ID is set
// (prevents races in concurrent calls like Promise.all)
export async function ensureSessionId(): Promise<void> {
  if (!sessionId) {
    const url = import.meta.env.VITE_TRANSMISSION_RPC_URL ?? '/transmission/rpc';
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'session-get', arguments: {} }) // Dummy valid request
    });
    if (res.status === 409) {
      sessionId = res.headers.get('X-Transmission-Session-Id') || '';
      if (!sessionId) {
        throw new Error('Failed to get Transmission session ID');
      }
    }
  }
}
