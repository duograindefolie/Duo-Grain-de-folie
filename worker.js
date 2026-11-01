// Cloudflare Worker : crée une session de paiement Stripe à partir du panier.
// Les prix sont relus dans produits.json (sur votre site), jamais envoyés par le navigateur.
//
// Variables à définir dans Cloudflare (Settings > Variables and Secrets) :
//   STRIPE_KEY     (secret)  clé secrète ou restreinte Stripe (sk_... ou rk_...)
//   SITE_URL       adresse du site, sans "/" final, ex. https://duograindefolie.github.io/Duo-Grain-de-folie
//   SHIPPING_RATE  (facultatif) identifiant d'un tarif de livraison Stripe (shr_...)

export default {
  async fetch(req, env) {
    const origin = new URL(env.SITE_URL).origin;
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), {
        status: s,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);

    try {
      const { items } = await req.json();
      if (!Array.isArray(items) || !items.length || items.length > 50) {
        return json({ error: 'panier' }, 400);
      }

      const res = await fetch(env.SITE_URL + '/produits.json', { cf: { cacheTtl: 60 } });
      const catalogue = (await res.json()).produits;

      const p = new URLSearchParams();
      p.set('mode', 'payment');
      p.set('locale', 'fr');
      p.set('success_url', env.SITE_URL + '/?merci=1');
      p.set('cancel_url', env.SITE_URL + '/');
      p.set('phone_number_collection[enabled]', 'true');
      ['FR', 'BE', 'LU', 'CH'].forEach((c, i) =>
        p.set(`shipping_address_collection[allowed_countries][${i}]`, c)
      );
      if (env.SHIPPING_RATE) p.set('shipping_options[0][shipping_rate]', env.SHIPPING_RATE);

      items.forEach((it, i) => {
        const prod = catalogue.find((x) => x.id === it.id && x.dispo !== false);
        if (!prod) throw new Error('produit inconnu');
        const qty = Math.min(20, Math.max(1, parseInt(it.qty) || 1));
        const perso = String(it.perso || '').slice(0, 80);
        p.set(`line_items[${i}][quantity]`, qty);
        p.set(`line_items[${i}][price_data][currency]`, 'eur');
        p.set(`line_items[${i}][price_data][unit_amount]`, Math.round(prod.prix * 100));
        p.set(`line_items[${i}][price_data][product_data][name]`, prod.nom);
        if (perso) {
          p.set(
            `line_items[${i}][price_data][product_data][description]`,
            (prod.perso || 'Personnalisation') + ' : ' + perso
          );
        }
      });

      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.STRIPE_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: p,
      });
      const session = await r.json();
      if (!session.url) return json({ error: 'stripe' }, 502);
      return json({ url: session.url });
    } catch (e) {
      return json({ error: 'erreur' }, 400);
    }
  },
};
