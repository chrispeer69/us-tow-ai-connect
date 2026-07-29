const fs = require('fs');

function patchFile(path, oldText, newText) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(oldText, newText);
  fs.writeFileSync(path, content);
}

patchFile(
  'packages/web/src/app/admin/branding/page.tsx',
  `      const res = await fetch(\`\${API_BASE}/v1/admin/branding\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': DEFAULT_TENANT_ID },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? \`HTTP \${res.status}\`);
      const updated = await res.json();`,
  `      const updated = await api<Branding>('/v1/admin/branding', {
        method: 'PUT',
        json: form,
      });`
);

patchFile(
  'packages/web/src/app/admin/branding/page.tsx',
  `    fetch(\`\${API_BASE}/v1/admin/branding\`, {
      headers: { 'x-tenant-id': DEFAULT_TENANT_ID },
    })
      .then((r) => (r.ok ? r.json() : DEFAULT_BRANDING))`,
  `    api<Branding>('/v1/admin/branding')
      .then((b) => b || DEFAULT_BRANDING)`
);

