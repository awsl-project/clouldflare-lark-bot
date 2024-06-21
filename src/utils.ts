import { Context } from 'hono'
import { Bindings } from './type';

export async function calculateSignature(
    timestamp: string, nonce: string, encryptKey: string, body: string
): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(timestamp + nonce + encryptKey + body);

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sign = hashArray.map(byte => {
        return byte.toString(16).padStart(2, '0');
    }).join('');

    return sign;
}

export async function genSign(timestamp: number, secret: string, body = ""): Promise<string> {
    const encoder = new TextEncoder();
    const data = `${timestamp}\n${secret}`;
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(data),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(body)
    );
    const sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return sign;
}

export async function getAccessLarkToken(c: Context<{ "Bindings": Bindings }>): Promise<string> {
    const cachedToken = await c.env.KV.get("LARK_ACCESS_TOKEN");
    if (cachedToken) {
        return cachedToken;
    }
    const token_res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "app_id": c.env.LARK_APP_ID,
            "app_secret": c.env.LARK_APP_SECRET
        })
    })
    const { tenant_access_token, expire } = await token_res.json() as {
        tenant_access_token: string, expire: number
    };
    await c.env.KV.put("LARK_ACCESS_TOKEN", tenant_access_token, { expirationTtl: expire - 60 });
    return tenant_access_token;
}
