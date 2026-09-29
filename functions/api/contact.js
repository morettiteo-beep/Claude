/**
 * Cloudflare Pages Function — POST /api/contact
 * Riceve i dati del modulo di contatto e invia una email.
 *
 * Configurazione (Cloudflare → Pages → Settings → Environment variables):
 *   RESEND_API_KEY   chiave API di Resend (https://resend.com — piano gratuito)
 *   MAIL_TO          destinatario, es. berlinzani@saveforex.it
 *   MAIL_FROM        mittente verificato su Resend, es. "Saveforex <noreply@saveforex.it>"
 *
 * Niente backend da gestire: la funzione gira sull'edge di Cloudflare.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // accetta solo richieste che arrivano dal sito stesso (blocca i POST da altri siti)
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Richiesta non valida." }, 403);
  }

  // corpo: limite di dimensione e JSON obbligatorio (un oggetto)
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return json({ error: "Richiesta troppo grande." }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Richiesta non valida." }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ error: "Richiesta non valida." }, 400);
  }

  // honeypot anti-spam: se compilato, fingiamo successo e scartiamo
  if (data.website) return json({ ok: true });

  const nome = (data.nome || "").toString().trim().slice(0, 120);
  const email = (data.email || "").toString().trim().slice(0, 160);
  const interesse = (data.interesse || "Generico").toString().replace(/[\r\n]+/g, " ").trim().slice(0, 80);
  const messaggio = (data.messaggio || "").toString().trim().slice(0, 4000);

  if (!nome || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Nome o email non validi." }, 422);
  }

  // Se le variabili non sono configurate, restituiamo un errore "soft":
  // il front-end mostra il fallback con l'indirizzo email.
  if (!env.RESEND_API_KEY || !env.MAIL_TO || !env.MAIL_FROM) {
    return json({ error: "Servizio email non configurato." }, 503);
  }

  const subject = `Nuova richiesta dal sito · ${interesse}`;
  const text =
    `Nuova richiesta dal sito Saveforex\n\n` +
    `Nome: ${nome}\nEmail: ${email}\nInteresse: ${interesse}\n\n` +
    `Messaggio:\n${messaggio || "(nessun messaggio)"}\n`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">` +
    `<h2 style="margin:0 0 12px">Nuova richiesta dal sito Saveforex</h2>` +
    `<p><b>Nome:</b> ${esc(nome)}<br>` +
    `<b>Email:</b> ${esc(email)}<br>` +
    `<b>Interesse:</b> ${esc(interesse)}</p>` +
    `<p><b>Messaggio:</b><br>${esc(messaggio || "(nessun messaggio)").replace(/\n/g, "<br>")}</p>` +
    `</div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [env.MAIL_TO],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });
    if (!r.ok) {
      // il dettaglio resta nei log di Cloudflare: non lo mostriamo a chi compila il modulo
      console.error("Resend ha risposto", r.status, await r.text());
      return json({ error: "Invio non riuscito." }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("Errore di rete verso Resend", e);
    return json({ error: "Errore di rete." }, 502);
  }
}

// metodi non-POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", { status: 405 });
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
