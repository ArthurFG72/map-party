import assert from "node:assert/strict";
import test from "node:test";
import { prepareOfflinePackageForStorage, validateOfflinePackage } from "../src/offlinePackage.js";

const region = { version: 1, id: "centro", nodes: [{ lat: -23.55, lng: -46.63, edges: [{ to: 1, distance: 120 }] }, { lat: -23.551, lng: -46.631, edges: [] }] };

test("aceita pacote regional de rotas válido", () => assert.deepEqual(validateOfflinePackage(region), { id: "centro", nodes: region.nodes }));
test("recusa pacote acima do limite de armazenamento", () => assert.equal(prepareOfflinePackageForStorage(region, 8), null));
test("rejeita arestas que apontam fora do pacote", () => assert.equal(validateOfflinePackage({ ...region, nodes: [{ ...region.nodes[0], edges: [{ to: 9, distance: 1 }] }, region.nodes[1]] }), null));