import { Hono } from 'hono'
import { Bindings } from './type';
import { getAccessLarkToken, genSign } from './utils';

const app = new Hono<{ "Bindings": Bindings }>()

app.get('/', (c) => {
    return c.text('Hello Hono!')
})

app.post('/lark_callback', async (c) => {
    const { challenge, type, header: { token, event_type }, event } = await c.req.json()
    if (token != c.env.LARK_VERIFICATION_TOKEN) {
        return c.text('Invalid token', 400)
    }
    if (type === 'url_verification') {
        return c.json({ challenge })
    }
    if (event_type == "im.message.receive_v1") {
        const { message: { message_id, message_type, content } } = event;
        if (message_type !== "text") return c.text("ok");
        // check message_id
        const cachedMessageId = await c.env.KV.get(`LARK_MESSAGE_ID_${message_id}`);
        if (cachedMessageId) {
            return c.text("ok");
        }
        await c.env.KV.put(`LARK_MESSAGE_ID_${message_id}`, "true", { expirationTtl: 300 });
        const handler = async (): Promise<void> => {
            // Get access token
            const access_token = await getAccessLarkToken(c);
            const { text } = JSON.parse(content) as { text: string };
            const prompt = text.replace(/^@\S+\s/, "").trim();
            if (!prompt) {
                return;
            }
            const reply = {
                "text": "请输入内容"
            }
            if (prompt == "摸鱼" || prompt == "摸鱼办" || prompt == "moyu") {
                const res = await fetch(c.env.MOYU_URL);
                reply.text = (await res.text()).trim();
            }
            else if (prompt == "awsl") {
                const res = await fetch(`${c.env.AWSL_API_URL}/v2/random`)
                reply.text = await res.json()
            }
            else {
                const ai_response = await fetch(
                    `${c.env.OPENAI_API_URL}/v1/chat/completions`,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": c.env.OPENAI_API_KEY,
                        },
                        method: "POST",
                        body: JSON.stringify({
                            model: "gpt-3.5-turbo",
                            messages: [{ role: "user", content: prompt }],
                        }),
                    }
                )
                const response = await ai_response.json() as any;
                reply.text = response?.choices[0]?.message?.content || reply.text;
            }
            await fetch(`https://open.larksuite.com/open-apis/im/v1/messages/${message_id}/reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${access_token}`
                },
                body: JSON.stringify({
                    "msg_type": "interactive",
                    "content": JSON.stringify({
                        "config": {
                            "wide_screen_mode": true
                        },
                        "elements": [
                            {
                                "tag": "markdown",
                                "content": reply.text
                            },
                        ]
                    })
                })
            })
        }
        c.executionCtx.waitUntil(handler());
    }
    return c.text('ok')
})

app.post('/lark_bot_webhook_moyuban', async (c) => {
    const { url, secret } = await c.req.json()
    const res = await fetch(c.env.MOYU_URL);
    const text = (await res.text()).trim();
    const timestamp = Math.floor(Date.now() / 1000);
    await fetch(url, {
        method: "POST",
        body: JSON.stringify(
            {
                "timestamp": timestamp,
                "msg_type": "interactive",
                "sign": await genSign(timestamp, secret),
                "card": {
                    "config": {
                        "wide_screen_mode": true
                    },
                    "header": {
                        "title": {
                            "tag": "plain_text",
                            "content": "摸鱼办"
                        },
                        "template": "blue"
                    },
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": text
                        },
                    ]
                }
            }
        ),
    })
    return c.text("ok")
})

app.post('/lark_bot_webhook_binance', async (c) => {
    const { url, secret, data } = await c.req.json() as {
        url: string, secret: string, data: {
            symbol: string, price: string
        }[]
    }
    const timestamp = Math.floor(Date.now() / 1000);
    await fetch(url, {
        method: "POST",
        body: JSON.stringify(
            {
                "timestamp": timestamp,
                "msg_type": "interactive",
                "sign": await genSign(timestamp, secret),
                "card": {
                    "config": {
                        "wide_screen_mode": true
                    },
                    "header": {
                        "title": {
                            "tag": "plain_text",
                            "content": "币安实时价格"
                        },
                        "template": "blue"
                    },
                    "elements": [
                        {
                            "tag": "div",
                            "content": "# 币安实时价格\n\n" + data.map(
                                ({ symbol, price }) => `- ${symbol}: ${price}`
                            ).join("\n")
                        },
                    ]
                }
            }
        ),
    })
    return c.text("ok")
})


app.post('/lark_bot_webhook_stock', async (c) => {
    const { url, secret } = await c.req.json() as {
        url: string, secret: string
    }
    const req = await fetch(
        "https://financialmodelingprep.com/api/v3/quote/NVDA,AAPL,MSFT?apikey="
        + c.env.STOCK_API_KEY)
    const data = await req.json() as {
        symbol: string, name: string,
        price: string, change: string,
        open: string, previousClose: string
    }[]
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify(
            {
                "timestamp": timestamp,
                "msg_type": "interactive",
                "sign": await genSign(timestamp, secret),
                "card": {
                    "config": {
                        "wide_screen_mode": true
                    },
                    "header": {
                        "title": {
                            "tag": "plain_text",
                            "content": "股票实时价格"
                        },
                        "template": "blue"
                    },
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": "\n" + data.map(
                                ({
                                    symbol, name, price, change,
                                    open, previousClose
                                }) =>
                                    `- ${symbol}(${name}): ${price}(${change}) `
                                    + `开盘: ${open} 昨收: ${previousClose}`
                            ).join("\n")
                        },
                    ]
                }
            }
        ),
    })
    return c.text("ok")
})

export default app
