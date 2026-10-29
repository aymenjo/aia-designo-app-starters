# Évaluation de la lecture IA des avis

Le PRD fixe un seuil : sur 20 avis réels anonymisés, au moins 90 % des champs lus sont justes. Les champs comptés sont le n° d'avis, la plaque, la date et l'heure, le lieu, l'infraction, le montant et la date d'envoi. Ce script mesure ce taux, et on peut le relancer après chaque changement du lecteur : modèle, effort ou consignes, dans `src/lib/avis/lecteur-claude.ts`.

Il appelle l'API Claude avec le même lecteur que l'application. Chaque lancement coûte donc quelques centimes par avis, et il ne tourne pas en CI.

## Constituer le jeu

Le dossier `evaluation/avis/` est ignoré par git. Les avis, même anonymisés, ne quittent pas ton poste.

1. Rassemble 20 avis réels, scans ou photos, au format PDF, JPG ou PNG. Une photo HEIC se convertit d'abord en JPG. Varie les cas : scans nets, photos de travers ou mal éclairées, avis électroniques en PDF.
2. Anonymise ce qui ne sert pas à la lecture : nom et adresse du destinataire, codes de paiement. Laisse lisibles les 7 champs lus.
3. Dépose les fichiers dans `evaluation/avis/`.
4. Écris `evaluation/avis/attendu.json`. Pour chaque fichier, donne les valeurs justes, aux formats de l'écran de saisie :

   ```json
   {
     "avis-01.pdf": {
       "numero": "1234567890",
       "plaque": "AB-123-CD",
       "infraction_date": "03/10/2026",
       "infraction_heure": "08:30",
       "lieu": "A6, Auxerre, sens Paris-Province",
       "infraction": "Excès de vitesse inférieur à 20 km/h",
       "montant": "135,00",
       "date_envoi": "06/10/2026"
     }
   }
   ```

   Un champ absent de l'avis se met à `null`. Les valeurs passent par les règles de l'écran : un attendu fautif arrête le script, qui nomme le fichier.

## Lancer

La clé d'API va dans `.env.development.local`, que `next dev` lit aussi :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Puis :

```bash
npm run eval:lecture
```

## Lire le résultat

- **Justesse par champ et au total.** Le script échoue sous 90 %.
- **Champs « Sûr » faux.** C'est le cas dangereux : un champ faux, affiché en vert, que le gestionnaire ne vérifiera pas. Il doit rester à 0.
- **Le détail de chaque champ faux.** On y lit ce qui a été lu, ce qui était attendu, et le niveau affiché.
- **Latence moyenne et maximale, coût mesuré.** Le coût est calculé au prix de Claude Opus 5.5, d'après les jetons consommés.

Le lieu et l'infraction se comparent sans casse, accents, ponctuation ni espaces en trop. Les autres champs se comparent une fois normalisés, comme à l'enregistrement. Un champ vide alors qu'une valeur était attendue compte comme faux.

## Régler le lecteur

Ces réglages sont dans `src/lib/avis/lecteur-claude.ts` :

- **L'effort** vaut `medium`. Si la justesse tient à 90 % en `low`, on y passe : la lecture est plus rapide pour le gestionnaire, qui l'attend au dépôt.
- **Les consignes.** Un champ souvent faux se corrige d'abord par une précision dans les consignes, par exemple sur le numéro à ne pas confondre.

Après chaque réglage, relance le script. Le critère de la phase 9 se coche dans `docs/PLAN.md` une fois le seuil atteint sur le vrai jeu.
