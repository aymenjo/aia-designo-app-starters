# Événements Composio

Les livraisons du webhook de Composio (V3) que le schéma `schemaEvenement` (src/lib/gmail/regles.ts) doit lire :

- `doc-*.json` : les exemples de la documentation de Composio ;
- `essai-*.json` : les livraisons relevées pendant l'essai avec une vraie boîte (`npm run composio -- ecouter`),
  anonymisées : adresses, objets, ids et contenus remplacés.
