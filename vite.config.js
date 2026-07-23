var _a, _b;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// A porta do dev server vem da variável de ambiente PORT quando o ambiente
// atribui uma (evita conflito quando a 5173 já está ocupada). Sem PORT, mantém
// o padrão 5173. Lido via globalThis porque o projeto não tem @types/node.
var envPort = Number((_b = (_a = globalThis
    .process) === null || _a === void 0 ? void 0 : _a.env) === null || _b === void 0 ? void 0 : _b.PORT);
// NaN > 0 é false, então PORT ausente/inválida cai no 5173 sem precisar de isFinite.
var port = envPort > 0 ? envPort : 5173;
export default defineConfig({
    plugins: [react()],
    server: {
        port: port,
        // Escuta em todas as interfaces — permite acesso de outras máquinas da rede.
        host: true,
    },
});
