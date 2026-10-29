# Design System — Désigno

## Product Context
- **Quoi** : une web app qui permet à une PME de ne plus jamais laisser filer une échéance de désignation. Désigno lit l'avis, propose le conducteur d'après le planning et prépare un récap prêt à reporter sur le site de l'ANTAI.
- **Pour qui** : le gestionnaire, c'est-à-dire l'office manager ou l'assistant·e administratif·ve d'une PME de 10 à 50 salariés qui a 5 à 30 véhicules. Il n'est pas expert, il est pressé et stressé par les échéances. Il travaille sur ordinateur et garde son téléphone à portée de main.
- **Espace** : SaaS B2B de gestion administrative. La référence de structure est ClickUp (fiche dans `docs/references/clickup-style.md`).
- **Type** : hybride.
  - Web app desktop-first.
  - Landing page.
  - Deux écrans soignés sur mobile : le dépôt d'un avis et le tableau de bord.
- **Memorable thing** : **« Rien ne m'échappe »**. Calme et maîtrise : l'urgent se voit d'un coup d'œil, sans faire peur.

## Aesthetic Direction
- **Direction** : Utilitaire apaisé, un Industrial/Utilitarian adouci.
  - La fonction passe d'abord, les données sont en mono et la palette est sourde.
  - Les pilules de ClickUp apportent la douceur.
- **Décoration** : minimale. La typo et les filets de 1 px font le travail. Seules deux choses bougent ou se colorent d'elles-mêmes : la jauge d'échéance et la bordure de l'agent.
- **Mood** : un bureau rangé un lundi matin. Un tableau de bord où tout est traité est blanc et vert, et on le comprend sans lire.
- **Références** : ClickUp, pour la structure seulement.
  - **Repris** : CTA pilule encre, pilules partout, barre latérale grise, filets 1 px, titres serrés à -0.04em, courbes de transition, bordure conique.
  - **Retirés** : le violet, l'arc-en-ciel, le dégradé cyan→magenta, le bleu des liens et Inter.
- **Ce qu'on joue safe** :
  - **Fond blanc, CTA pilule encre, listes avec pastilles de statut.** C'est la grammaire SaaS moderne (ClickUp, Linear, Notion) : il n'y a rien à apprendre.
  - **Feux tricolores pour la confiance et l'échéance.** Le PRD les prescrit déjà, et le sens est universel.
  - **Barre latérale, contenu et panneau latéral.** C'est la structure attendue d'une web app.
- **Les risques pris** :
  - **Vert = marque = « sous contrôle ».**
    - Gain : la couleur s'explique d'elle-même.
    - Coût : aucun vert décoratif, des liens en encre forcément soulignés, une landing moins « punchy ».
  - **Mono pour les données copiables.**
    - Gain : zéro erreur 0/O ou 1/I/l, et une identité « plaque ».
    - Coût : une 3ᵉ police à charger, et des colonnes plus larges.
  - **La plaque, seule forme rectangulaire.**
    - Gain : on la repère instantanément.
    - Coût : une exception à la règle des pilules, à protéger dans les composants.
  - **Bordure conique seulement pendant la recherche.**
    - Gain : un clin d'œil à ClickUp, qui a un sens.
    - Coût : une version sans animation est obligatoire, et l'arrêt doit être fiable (Arrêter, erreur, réponse reçue).

## Typography
- **Display/Hero** : **Plus Jakarta Sans 700/800**, pour les titres de page, les chiffres des tuiles et le hero de la landing.
  - Interlettrage -0.04em à 48 px et plus, -0.03em à 32 px, -0.02em à 24 px.
  - Elle est géométrique et chaleureuse sans être enfantine. Ses chiffres 800 donnent du poids aux euros évités.
- **Body** : **Geist 400/500/600**, pour le corps et toute l'interface.
  - Neutre et très lisible à 13–14 px. Elle remplace Inter sans en avoir l'air générique.
- **Data/Tables** : **Geist avec `font-variant-numeric: tabular-nums`**, pour les dates, montants et compteurs dans les listes, afin que les colonnes s'alignent. Cette propriété est appliquée sur `body`.
- **Données copiables** : **JetBrains Mono 500**, pour les plaques, n° d'avis, permis, SIREN, TVA, et les valeurs du récap ANTAI (dates et montants compris).
  - Elle sert aussi aux libellés méta en majuscules : 11 px, +0.06em.
  - Son zéro pointé distingue 0 de O et 1 de I et l, ce qui compte quand on recopie sur l'ANTAI.
- **Code** : JetBrains Mono, rarement visible.
- **Loading** :
  - App Next.js : `next/font/google` avec `Plus_Jakarta_Sans` (700, 800), `Geist` (400, 500, 600) et `JetBrains_Mono` (500), exposées en variables CSS et branchées sur `--font-display`, `--font-sans` et `--font-mono`.
  - Landing et preview : `https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@500&family=Plus+Jakarta+Sans:wght@700;800&display=swap`.
  - Ne jamais retomber sur `system-ui` en titre ou en corps.
- **Scale** : 11 · 12 · 13 · 14 · 16 · 20 · 24 · 32 · 48 · 64 px.

  | Token | Taille | Usage |
  |---|---|---|
  | `meta` | 11 px mono, majuscules, +0.06em | Libellés de champ du récap, en-têtes de colonnes |
  | `caption` | 12 px | Pastilles, légendes, sous-lignes |
  | `label` | 13 px | Libellés de formulaire, texte secondaire des tuiles |
  | `body` | 14 px | Corps de l'app |
  | `lead` | 16 px | Corps de la landing, titres de carte |
  | `title-sm` | 20 px | Titres de bloc |
  | `title` | 24 px, Jakarta 700 | Titre de page |
  | `stat` | 32 px, Jakarta 800 | Chiffres des tuiles |
  | `display` | 48 px, Jakarta 800 | Titres de section de la landing |
  | `hero` | 64 px, Jakarta 800 (40 sur mobile) | Hero de la landing |

- **Formats** : tout passe par `Intl` en `fr-FR`.
  - Dates : JJ/MM/AAAA, et JJ/MM dans les pastilles.
  - Heures : sur 24 h.
  - Montants : « 135,00 € », avec une espace fine insécable pour les milliers (« 24 975 € ») et une espace insécable avant €.
  - Un montant ne se coupe jamais en fin de ligne.

## Color
- **Approche** : restreinte. **La couleur n'a que 3 sens**, comme des feux tricolores. Tout le reste est en encre et en gris.
- **Primary** : Encre `#202020`, pour les CTA, titres, liens soulignés et l'anneau de focus. Survol du CTA : `#383838`.
- **Secondary (marque)** : Vert sapin `#0E7A4E`, teinte `#E7F3EC` = **« sous contrôle »**.
  - Usages : logo, « Désigné », « Fiche complète », confiance sûre, euros évités, « ✓ Copié ».
- **Neutrals** (du plus clair au plus foncé) :

  | Hex | Rôle |
  |---|---|
  | `#FFFFFF` | Fond |
  | `#F8F9FA` | Surface : barre latérale, info, cadenas |
  | `#E9EBF0` | Bande des sections de la landing |
  | `#E8E8E8` | Filet par défaut |
  | `#D4D4D4` | Filet fort : champs, boutons secondaires |
  | `#B3B3B3` | Jauge calme, pointillés |
  | `#838383` | Désactivé, placeholder, icônes décoratives |
  | `#646464` | Texte secondaire et libellés méta |
- **Semantic** :

  | Sens | Texte | Remplissage | Teinte | Usages |
  |---|---|---|---|---|
  | success = sous contrôle | `#0E7A4E` | `#0E7A4E` | `#E7F3EC` | Désigné, fiche complète, confiance sûre, euros évités, Copié |
  | warning = à regarder | `#B45309` | `#D97706` | `#FDF3E3` | J-15 à J-3, « Incomplète », confiance à vérifier, « Véhicule inconnu » |
  | error = urgent | `#B42318` | `#D92D20` | `#FDECEA` | J-2 et au-delà, « Échéance dépassée », champ non lu, ligne impossible, bandeaux Gmail et paiement |
  | info | `#202020` | — | `#F8F9FA` | Encre sur gris, **sans bleu** : rien ne doit évoquer l'ANTAI ou le bleu Marianne |

  Le **texte** d'un signal utilise la colonne « Texte ». La colonne « Remplissage » sert aux jauges, points, filets et au badge plein, avec du texte blanc dessus.
- **Règles** :
  - Le vert est un **état, jamais une action**. « J'ai désigné sur l'ANTAI », « Valider ce conducteur » et « Confirmer » sont des boutons encre.
  - Les statuts « À traiter », « À valider » et « Classé » restent **neutres**. L'urgence est portée par la pastille d'échéance, jamais par le statut.
  - Les liens sont en encre et **toujours soulignés**, puisque aucune couleur ne les distingue.
  - Aucune couleur décorative : pas d'illustration colorée, pas de dégradé, pas d'icône dans un cercle coloré.
- **Contrastes vérifiés** (WCAG AA, texte de 14 px, 4,5:1 minimum) :

  | Texte | Sur blanc | Sur sa teinte |
  |---|---|---|
  | `#646464` | 5,92 | 5,61 sur `#F8F9FA` |
  | `#0E7A4E` | 5,37 | 4,71 |
  | `#B45309` | 5,02 | 4,57 |
  | `#B42318` | 6,57 | 5,75 |
  | Blanc sur `#D92D20` | 4,83 | — |
  | `#838383` | 3,79 ✗ | désactivé ou placeholder uniquement, jamais pour du texte à lire |
- **Dark mode** : pas en v1. Les couleurs passent toutes par des variables sémantiques (`--bg`, `--surface`, `--text`, `--signal-*`), branchées sur Tailwind via `@theme inline`. Un mode sombre ne demandera donc que de redéfinir ces variables.

## Spacing
- **Base** : 4 px.
- **Densité** : elle suit l'écran. Elle est dense là où l'on compare (listes, planning), confortable là où l'on vérifie (avis, récap) et aérée sur la landing.
- **Scale** : 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48) 4xl(64) 5xl(80).

  | Écran | Mesures |
  |---|---|
  | Liste des avis | Lignes de 52 px |
  | Vérification d'un avis et récap ANTAI | Champs de 40 px, écart de 16 px, boutons « Copier » de 32 px |
  | Planning | Lignes de 36 px |
  | Tuiles | Padding de 24 px (20 px quand le panneau de l'agent est ouvert) |
  | Landing | 80 px entre les sections |
  | Mobile | Cibles tactiles d'au moins 44 px, gouttière de 16 px |

## Layout
- **Approche** : hybride.
  - L'app suit une grille disciplinée.
  - La landing reprend le rythme de ClickUp : un hero en 2 colonnes avec la vraie interface à droite, puis des bandes `#E9EBF0` qui alternent avec des sections blanches.
- **Grid** : 12 colonnes en desktop, 8 en tablette, 4 en mobile.
- **Shell de l'app** :
  - **Barre latérale de 232 px** :
    - fond `#F8F9FA` et filet à droite ;
    - « Déposer un avis » en pilule encre pleine largeur ;
    - éléments de nav en pilule de 36 px ; l'élément actif est sur `rgba(0,0,0,.06)`, en 600.
  - **Barre haute de 56 px** :
    - à gauche, la raison sociale ;
    - à droite, le compteur d'usage Free (ou la mention « Plan Pro »), le bouton « Demande à Désigno » et l'avatar.
  - **Contenu** : 1200 px maximum, avec 32 px de padding.
  - **Panneau de l'agent** : 400 px à droite. Il pousse le contenu à partir de 1440 px de large et passe en superposition en dessous. Il n'existe pas sur mobile.
- **Écrans clés** :
  - Avis : l'image et les champs sont en 7/5. L'image est zoomable et reste fixe pendant le défilement des champs.
  - Récap ANTAI : une colonne de 720 px maximum, en 3 blocs (Avis, Entreprise, Conducteur).
  - Tableau de bord mobile : les tuiles en 2×2, puis les 5 prochaines échéances en lignes empilées.
- **Max content width** : 1200 px pour l'app, 720 px pour le récap, 1200 px pour la landing.
- **Border radius** :

  | Token | Rayon | Usage |
  |---|---|---|
  | `plate` | 4 px | La plaque : la **seule** forme rectangulaire |
  | `field` | 10 px | Champs |
  | `card` | 12 px | Cartes, tuiles, alertes |
  | `panel` | 20 px | Panneaux, grandes cartes, hero |
  | `full` | 9999 px | Boutons, tags, badges, nav, échéance |
- **Ombres** : presque aucune. Les cartes et tuiles n'ont qu'un filet.
  - Popover : `0 4px 16px rgba(13,21,48,.08)`.
  - Panneau de l'agent : `-8px 0 24px rgba(13,21,48,.06)`.
- **Icônes** : Lucide, trait de 1,5 px, 16 px dans l'interface et 20 px sur mobile. Jamais dans un cercle coloré.

## Motion
- **Approche** : minimale et fonctionnelle. Une animation doit expliquer un changement d'état, sinon elle n'existe pas.
- **Easing** :
  - Entrée : `cubic-bezier(0.33, 1, 0.68, 1)`.
  - Sortie : `cubic-bezier(0.32, 0, 0.67, 0)`.
  - Rotation de la bordure de l'agent : `linear`.
- **Duration** :

  | Durée | Usage |
  |---|---|
  | 120 ms | Survol |
  | 200 ms | « Copié », bascules, cases |
  | 300 ms | Ouverture et fermeture du panneau |
  | 450 ms | Remplissage de la jauge au premier affichage |
  | 1,2 s | Un tour de la bordure conique, en boucle, **uniquement pendant une recherche** |
- **« ✓ Copié »** reste affiché en vert 1,5 s, puis le bouton revient à « Copier ».
- **`prefers-reduced-motion`** : la bordure de l'agent devient un filet gris statique, la jauge s'affiche sans animation et les transitions passent à 0 ms.

## Composants signature

### Échéance : le compte à rebours des 45 jours
- **Forme** : une pilule qui contient le texte et une jauge de 40 × 4 px (32 px dans les listes).
- **Texte** :
  - Dans les listes et les cartes : « avant le JJ/MM · J-n ».
  - Sur l'écran d'un avis : « avant le JJ/MM/AAAA · J-n », au format du PRD.
- **La jauge montre le temps qui reste** : largeur = jours restants / 45. Elle se vide à l'approche de l'échéance, sans grossir en rouge sur l'écran.

| Niveau | Condition | Rendu |
|---|---|---|
| Calme | J-16 et plus | Fond blanc, filet `#E8E8E8`, texte `#646464`, J-n en encre, jauge `#B3B3B3` |
| À regarder | J-15 à J-3 | Teinte ambre, texte `#B45309`, jauge `#D97706` |
| Urgent | J-2 à J-0 | Teinte rouge, texte `#B42318`, jauge `#D92D20` |
| Dépassée | après J-0 | « dépassée le JJ/MM · J+n », jauge vide, plus le badge plein « Échéance dépassée ». Le statut ne change pas. |
| Désigné | — | Teinte verte, « Désigné le JJ/MM », jauge verte pleine |
| Classé | — | Fond transparent, filet pointillé `#B3B3B3`, « Classé le JJ/MM » en `#646464`, sans jauge |

- **Seuils** : ils reprennent ceux des alertes (J-15, J-7, J-2). La fonction de référence est `niveauEcheance(joursRestants)`.

### Plaque
- JetBrains Mono 500 en 13 px (20 px en grand), filet encre de 1 px, fond blanc, **rayon 4**.
- Toujours en majuscules, avec des tirets. L'ancien format s'affiche aussi avec des tirets, par exemple « 123-ABC-45 ».
- Aucun composant ne doit l'arrondir.

### Statuts
| Statut | Rendu |
|---|---|
| À traiter | Fond `#F8F9FA`, filet `#E8E8E8`, texte encre |
| À valider | Fond encre, texte blanc |
| Désigné | Vert sur teinte verte, avec une coche |
| Classé | Fond transparent, filet pointillé `#B3B3B3`, texte `#646464` |

### Badges
| Badge | Rendu |
|---|---|
| Échéance dépassée | Fond `#D92D20` plein, texte blanc 600 |
| Véhicule inconnu | Ambre sur teinte |
| Verrouillé | `#646464` sur `#E9EBF0`, avec un cadenas |
| Lecture seule | Comme « Verrouillé » : `#646464` sur `#E9EBF0`, avec un cadenas. Sur un véhicule, au retour en Free |
| Fiche complète | Vert sur teinte, avec une coche |
| Incomplète · n champs | Ambre sur teinte |

### Confiance par champ (vérification d'un avis)
- Un point de 8 px devant le libellé et un filet gauche de 2 px sur le champ, dans la couleur du niveau.
- Un mot à droite : « Sûr », « À vérifier » ou « Non lu ».
- Un champ rouge a un fond teinté rouge et un bouton secondaire « Confirmer ce champ ». L'avis passe en « À valider » une fois tous les champs rouges confirmés.
- Une valeur lue mais refusée par les règles (un n° qui n'a pas 10 chiffres) laisse le champ vide et rouge.
  - Le mot devient « Refusé ».
  - Sous le champ, en `#B42318` : « Relevé sur l'avis : » suivi de la valeur en mono, puis le motif de l'écran.
  - Le tout disparaît dès que le gestionnaire remplit le champ.

### Champ du récap ANTAI
- Libellé méta (mono 11 px, en majuscules), valeur en mono 15 px, et une pilule ghost de 32 px « Copier » avec l'icône copy.
- Au clic, le bouton passe à « ✓ Copié » en vert sur teinte pendant 1,5 s.
- Un seul champ est copié à la fois. Les valeurs ne sont jamais tronquées : elles passent à la ligne.

### Aperçu de l'email au conducteur
- Dans le bloc Désignation du récap, au-dessus de « J'ai désigné sur l'ANTAI ».
- **Case** : une case native encre, cochée par défaut, « Prévenir Karim Benali par email » en 500, et l'adresse dessous en 13 px `#646464`.
  - Sans email, la case est désactivée et son libellé passe en `#646464`. Dessous : « email manquant · Ajouter son email », ce dernier souligné. Il ouvre une fenêtre avec le seul champ Email de la fiche.
  - En Free, le cadenas Pro « Email au conducteur » remplace la case.
- **Aperçu**, visible tant que la case est cochée : une carte (rayon 12, filet 1 px, padding 20 px).
  - En tête, les libellés méta « À », « Répondre à » et « Objet », et leur valeur en corps 14 px.
  - Un filet, puis le corps : salutation, paragraphes, faits et pied en 13 px `#646464`.
  - Les faits sont des lignes séparées par des filets : le libellé en 13 px `#646464` sur 96 px, puis la valeur. Le véhicule montre la plaque, puis le modèle.
- **Après le clic**, l'alerte verte « Désigné le … » ajoute « Karim Benali a été prévenu par email. ».
- L'email lui-même reprend le gabarit des autres emails, sans logo, lien ni bouton : il part au nom de l'entreprise.

### Tuile stat
- Libellé en 13 px `#646464`, chiffre en Jakarta 800 32 px encre, sous-ligne en 13 px. Sur téléphone, en 2×2, le padding passe à 16 px et le chiffre à 28 px.
- **Seule la tuile des euros évités met son chiffre en vert.**
- Dans les sous-lignes, seul un élément en alerte prend la couleur de son signal (par exemple « 1 à J-2 » en rouge).
- Les 4 tuiles du PRD :
  - Avis à traiter ;
  - Échéances proches ;
  - Avis désignés ;
  - Euros d'amendes évités, avec le libellé « amendes de non-désignation évitées ».

### Usage Free et cadenas Pro
- **Compteur d'usage** : une pilule `#F8F9FA` avec un filet, « **2/3** véhicules | **4/5** avis ce mois-ci ».
- **Cadenas Pro** :
  - un bloc `#F8F9FA` ;
  - une icône cadenas dans un rond blanc ;
  - le nom de la fonction en 600 et une phrase d'explication ;
  - une pilule « PRO » encre et le lien « Passer en Pro ».

### Choix des véhicules actifs (retour en Free)
- Une étape plein écran, **sans barre latérale** : une barre haute de 56 px avec le logo et l'avatar, puis une colonne de 720 px, comme le récap.
- Le titre en Jakarta 700 24 px, puis une phrase qui dit que rien n'est supprimé et que les autres véhicules passent en lecture seule.
- Une liste de cases à cocher, en lignes de 52 px : la plaque, le modèle, le type, le conducteur de l'affectation ouverte et le nombre d'avis ouverts.
- Sous la liste, le compteur « n/3 choisis », le CTA encre « Garder ces 3 véhicules », actif seulement quand le compte est bon, et le lien « Repasser en Pro ».

### Bandeau persistant
- Pour la relève Gmail interrompue et l'échec de paiement.
- Teinte rouge, filet rouge `#D92D20` en bas, texte `#B42318`, et une action soulignée (« Reconnecter Gmail », « Mettre à jour ma carte »).
- Il reste affiché jusqu'à la résolution et ne se ferme pas.

### Rapport mensuel (PDF)
- **Format** : A4 portrait, 1 à 2 pages, marges de 40 pt. Les tokens de l'app passent en points : corps Geist 9,5 pt, libellés méta en mono 6,5 pt majuscules, titres de section en Jakarta 700 12 pt.
- **En-tête** : le logo, « Rapport de flotte » en Jakarta 700 20 pt, puis « raison sociale · mois » en `#646464`, et un filet.
- **Tuiles** : 4 tuiles en ligne (avis reçus, désignés, classés, échéances dépassées), filet 1 px et rayon 12 px, chiffre en Jakarta 800. Le chiffre des échéances dépassées passe en rouge `#B42318` dès qu'il y en a une. Dessous, la tuile pleine largeur des amendes évitées : le mois en vert, et le cumul dans la sous-ligne.
- **« Aucun avis ce mois-ci »** : un bloc `#F8F9FA` sous les tuiles, quand rien n'a été déposé.
- **Sections**, dans cet ordre : Échéances dépassées (n° en mono, plaque, échéance, statut), Les plus verbalisés · 12 mois (véhicules puis conducteurs, avec « 12 mois », « Mois » et « Montant » alignés à droite), Fiches incomplètes (le nom, puis les champs manquants en `#646464`).
  - Une section vide le dit en une phrase : en vert quand c'est « sous contrôle » (« Aucune échéance dépassée ce mois-ci. », « Toutes les fiches sont complètes. »), en `#646464` sinon.
  - Au-delà de 10 échéances ou de 15 fiches, « et n autres » : le rapport tient en 2 pages.
- **Plaque** : la même que dans l'app, mono, filet encre, rayon 4 px.
- **Pied de page** sur chaque page : « Généré le JJ/MM/AAAA · échéances indicatives · n/N », sous un filet.
- **Montants** : les polices du PDF n'ont pas l'espace fine insécable, remplacée par une espace insécable (« 24 975 € »).

### Adresses « direction » et écran Rapports
- **Fiche entreprise** : un bloc « Direction » après le siège, avec 3 champs email facultatifs, vérifiés à la sortie du champ et enregistrés par le même bouton. En Free, le cadenas Pro « Rapport mensuel » le remplace.
- **Rapports** (entrée de la barre latérale, après Planning, icône Lucide `file-chart-column`, visible en Free) : en tête, la date du prochain rapport et ses destinataires, avec un lien vers la fiche. Puis une ligne de 52 px par mois : le mois, « Envoyé le … à … » et ses adresses, « Envoi en attente » ou « Non envoyé », et un bouton secondaire « Télécharger ». Sans rapport : « Votre premier rapport arrivera le JJ/MM/AAAA. ». En Free, le seul cadenas Pro.

### Demande à Désigno
- **Bouton** :
  - pilule à contour encre avec le glyphe Lucide `message-square-text` ;
  - fond `rgba(0,0,0,.06)` quand le panneau est ouvert ;
  - en Free, un cadenas `#646464` après le libellé.
- **Panneau** : blanc, 400 px.
  - **En-tête de 56 px** : titre en Jakarta 700 16 px, puis les icônes historique, « Nouvelle conversation » et fermer.
  - **Contexte** : une pilule `#F8F9FA` « Sur : avis n° … », seulement quand le panneau est ouvert depuis un avis, un véhicule ou un conducteur.
  - **Compteur** : en mono, « 12/100 demandes ce mois-ci », sous la zone de saisie.
- **Pendant la recherche** :
  - l'étape en cours (« Je consulte le planning de AB-123-CD… ») s'affiche dans une carte à **bordure conique grise** (`#E8E8E8` → `#B3B3B3` → `#646464`) qui tourne ;
  - un bouton ghost « Arrêter » est à droite ;
  - la rotation s'arrête dès la réponse, l'erreur ou l'arrêt.
- **Messages** :
  - ceux du gestionnaire sont alignés à droite, sur `#F8F9FA` ;
  - ceux de l'agent sont en texte libre, et chaque élément cité est un lien souligné vers sa fiche.
- **Récapitulatif** :
  - une liste numérotée en mono, une ligne par modification ;
  - pour une modification, l'avant est barré en `#838383` → l'après en encre 500 ;
  - une ligne impossible est en teinte rouge, avec le motif des écrans en `#B42318` ;
  - les boutons sont « Confirmer » en encre, puis « Modifier » et « Annuler » en ghost ;
  - « Confirmer » est **désactivé** tant qu'il reste une ligne rouge ;
  - après application, le récapitulatif affiche « Appliqué le JJ/MM/AAAA à HH:MM ».

### Mobile
- **Dépôt** :
  - le titre en Jakarta 22 px ;
  - une zone de dépôt en pointillé avec les consignes (formats, 10 Mo) ;
  - une pilule encre pleine largeur de **56 px** « Photographier un avis », qui ouvre directement l'appareil photo ;
  - en dessous, un bouton secondaire de 44 px « Choisir un fichier ».
- **Accès au dépôt** : dans la barre haute, une pilule encre « Déposer » de 44 px avec l'icône Lucide `camera`, entre le logo et l'avatar. Elle n'existe que sur téléphone : sur ordinateur, « Déposer un avis » est en tête de la barre latérale.
- **Avis enregistré** : après le dépôt, l'écran reste sur le téléphone, sans ouvrir la saisie.
  - une alerte verte « Avis enregistré », qui rappelle que l'avis est « À traiter » ;
  - la pilule encre de 56 px « Photographier un autre avis », qui rouvre l'appareil photo ;
  - un bouton secondaire de 44 px « Voir l'avis ».
- **Tableau de bord** :
  - une barre haute avec le logo, la pilule « Déposer » et l'avatar ;
  - les tuiles en 2×2 ;
  - les 5 prochaines échéances, chaque ligne sur 3 rangées : échéance et statut, plaque et conducteur, puis l'avis.

### Logo
- La jauge des 45 jours bouclée : un cercle vert sapin avec une coche, suivi de « Désigno » en Jakarta 800.
- Il n'est jamais en couleur sur fond coloré.

## Tokens (Tailwind v4)

```css
@import "tailwindcss";

@property --angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }

/* Valeurs sémantiques : un futur mode sombre ne redéfinira que ce bloc. */
:root {
  --bg: #FFFFFF;
  --surface: #F8F9FA;
  --band: #E9EBF0;
  --border: #E8E8E8;
  --border-strong: #D4D4D4;
  --gray-300: #B3B3B3;
  --ink: #202020;
  --ink-hover: #383838;
  --text: #202020;
  --text-secondary: #646464;
  --text-disabled: #838383;

  --signal-ok: #0E7A4E;
  --signal-ok-tint: #E7F3EC;
  --signal-watch: #B45309;
  --signal-watch-fill: #D97706;
  --signal-watch-tint: #FDF3E3;
  --signal-urgent: #B42318;
  --signal-urgent-fill: #D92D20;
  --signal-urgent-tint: #FDECEA;
}

/* Couleurs : la palette par défaut est retirée, donc aucun bleu ni violet n'est possible. */
@theme inline {
  --color-*: initial;
  --color-white: #FFFFFF;
  --color-canvas: var(--bg);
  --color-surface: var(--surface);
  --color-band: var(--band);
  --color-line: var(--border);
  --color-line-strong: var(--border-strong);
  --color-gray-300: var(--gray-300);
  --color-ink: var(--ink);
  --color-ink-hover: var(--ink-hover);
  --color-secondary: var(--text-secondary);
  --color-disabled: var(--text-disabled);
  --color-ok: var(--signal-ok);
  --color-ok-tint: var(--signal-ok-tint);
  --color-watch: var(--signal-watch);
  --color-watch-fill: var(--signal-watch-fill);
  --color-watch-tint: var(--signal-watch-tint);
  --color-urgent: var(--signal-urgent);
  --color-urgent-fill: var(--signal-urgent-fill);
  --color-urgent-tint: var(--signal-urgent-tint);
}

@theme {
  --font-display: "Plus Jakarta Sans", ui-sans-serif, sans-serif;
  --font-sans: "Geist", ui-sans-serif, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-*: initial;
  --text-meta: 11px;      --text-meta--line-height: 1.4;  --text-meta--letter-spacing: 0.06em;
  --text-caption: 12px;   --text-caption--line-height: 1.4;
  --text-label: 13px;     --text-label--line-height: 1.45;
  --text-body: 14px;      --text-body--line-height: 1.5;
  --text-lead: 16px;      --text-lead--line-height: 1.6;
  --text-title-sm: 20px;  --text-title-sm--line-height: 1.3;
  --text-title: 24px;     --text-title--line-height: 1.2;   --text-title--letter-spacing: -0.02em;
  --text-stat: 32px;      --text-stat--line-height: 1.15;   --text-stat--letter-spacing: -0.03em;
  --text-display: 48px;   --text-display--line-height: 1.05; --text-display--letter-spacing: -0.04em;
  --text-hero: 64px;      --text-hero--line-height: 1;      --text-hero--letter-spacing: -0.04em;

  --spacing: 4px; /* h-13 = 52 (ligne d'avis), h-10 = 40 (champ), h-9 = 36 (planning), h-8 = 32 (Copier), h-14 = 56 (barre haute, CTA mobile), w-58 = 232 (barre latérale), w-100 = 400 (agent) */

  --breakpoint-wide: 90rem; /* 1440 px : le panneau de l'agent pousse le contenu */
  --container-content: 1200px;
  --container-recap: 720px;

  --radius-plate: 4px;
  --radius-field: 10px;
  --radius-card: 12px;
  --radius-panel: 20px;
  /* rounded-full = pilule */

  --shadow-popover: 0 4px 16px rgb(13 21 48 / 0.08);
  --shadow-agent: -8px 0 24px rgb(13 21 48 / 0.06);

  --ease-enter: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-exit: cubic-bezier(0.32, 0, 0.67, 0);

  --animate-agent-spin: agent-spin 1.2s linear infinite;
  --animate-gauge-fill: gauge-fill 450ms cubic-bezier(0.33, 1, 0.68, 1) both;

  @keyframes agent-spin { to { --angle: 360deg; } }
  @keyframes gauge-fill { from { transform: scaleX(0); } }
}

@layer base {
  body { @apply bg-canvas text-ink font-sans text-body; font-variant-numeric: tabular-nums; }
  a { @apply text-ink underline underline-offset-3 decoration-1 hover:decoration-2; }
  :focus-visible { @apply outline-2 outline-offset-2 outline-ink; }
}

@media (prefers-reduced-motion: reduce) {
  .animate-agent-spin, .animate-gauge-fill { animation: none; }
}
```

La bordure conique se compose ainsi : `padding: 1px` et `background: conic-gradient(from var(--angle), #E8E8E8 0deg 200deg, #B3B3B3 280deg, #646464 330deg, #E8E8E8 360deg)` sur l'enveloppe, plus `.animate-agent-spin`. L'intérieur est blanc, avec un rayon de 11 px. Le rendu de référence est `docs/design-preview.html`.

## Decisions Log
| Date | Décision | Rationale |
|------|----------|-----------|
| 2026-10-05 | Création initiale | /design et /interroge sur Désigno. Le PRD et le PLAN sont terminés, il n'y a pas encore de code. Public : un office manager non expert, stressé par les échéances. |
| 2026-10-05 | Structure ClickUp, signature retirée | On garde les pilules, le CTA encre, la barre latérale, les filets et les courbes. On retire le violet, l'arc-en-ciel, le dégradé et Inter. On emprunte une grammaire connue sans copier l'identité. |
| 2026-10-05 | Vert sapin = marque = « sous contrôle » | La couleur n'a que 3 sens. Un tableau de bord où tout est traité devient blanc et vert. |
| 2026-10-05 | Plus Jakarta Sans / Geist / JetBrains Mono | Des titres chaleureux, une interface neutre, et une mono à zéro pointé pour recopier sans erreur sur l'ANTAI. |
| 2026-10-05 | Signature : compte à rebours des 45 jours et plaque | L'échéance est le cœur du produit, et la plaque est la donnée que l'on cherche du regard. |
| 2026-10-05 | La jauge montre le temps restant | Elle se vide à l'approche de l'échéance et devient pleine et verte une fois désigné. L'urgent reste visible sans envahir l'écran : « sans faire peur ». |
| 2026-10-05 | Agent sobre, bordure conique grise | Un clin d'œil à ClickUp qui a un sens : la bordure ne tourne que pendant la recherche. |
| 2026-10-05 | Base 4 px, densité qui suit l'écran | Lignes de 52 px dans les listes, champs de 40 px pour la vérification, cibles de 44 px sur mobile. |
| 2026-10-05 | Rouge texte `#B42318` ajouté, `#D92D20` réservé au remplissage | `#D92D20` sur sa teinte n'atteint que 4,22:1, sous le seuil AA de 4,5:1. `#B42318` donne 5,75:1. C'est le même schéma que l'ambre (texte / remplissage). |
| 2026-10-05 | `#838383` réservé au désactivé et au placeholder | Il n'atteint que 3,79:1 sur blanc. Les libellés méta passent en `#646464` (5,92:1). |
| 2026-10-05 | Pas de mode sombre en v1 | Le gestionnaire travaille au bureau, en journée. Les variables sémantiques et `@theme inline` permettront de l'ajouter sans toucher aux composants. |
| 2026-10-14 | Dépôt sur téléphone : pilule « Déposer » dans la barre haute, puis écran « Avis enregistré » | Sur téléphone, le gestionnaire photographie l'avis à l'ouverture du courrier et saisit plus tard sur ordinateur. Le dépôt est donc à un geste depuis tous les écrans, et l'on enchaîne les photos sans ouvrir la saisie, trop étroite à côté de l'image. |
| 2026-10-14 | Mot « Refusé » et valeur relevée sous un champ lu mais refusé | Un spécimen dont le n° n'a pas 10 chiffres s'affichait « Non lu », alors que le n° est bien imprimé. Le gestionnaire voit maintenant ce que l'IA a relevé, et pourquoi ce n'est pas repris. Validé par l'utilisateur. |
| 2026-10-17 | Pastille « Classé le JJ/MM » neutre, sans jauge | Un avis classé sort du suivi : il n'a plus d'échéance à surveiller, ni rien de « sous contrôle » à montrer en vert. La pastille reprend le filet pointillé du statut « Classé » et de « Archivé le » des fiches. Validé par l'utilisateur. |
| 2026-10-17 | Pas de menu sur le tableau de bord mobile | La barre haute garde le logo, la pilule « Déposer » et l'avatar, comme sur les autres écrans. Sur téléphone, seuls le dépôt et le tableau de bord sont soignés : un menu mènerait à des écrans conçus pour l'ordinateur. Validé par l'utilisateur. |
| 2026-10-18 | Compteur d'usage Free sur l'écran de dépôt mobile | La barre haute mobile garde le logo, la pilule « Déposer » et l'avatar. Le compteur « 2/3 véhicules \| 4/5 avis ce mois-ci » s'affiche donc sous le titre de l'écran de dépôt, là où le quota compte : le gestionnaire sait avant la photo si l'avis sera « Verrouillé ». |
| 2026-10-25 | Badge « Lecture seule » repris de « Verrouillé » | Un véhicule en lecture seule et un avis verrouillé disent la même chose : la limite Free bloque, et rien n'est perdu. Le même gris et le même cadenas évitent d'ajouter un sens de couleur. Validé par l'utilisateur. |
| 2026-10-25 | Choix des véhicules actifs en étape plein écran, sans barre latérale | Tant qu'aucun véhicule n'est actif, les autres écrans mènent à ce choix : un menu n'y mènerait nulle part. L'étape tient sur une colonne de 720 px, comme le récap. Validé par l'utilisateur. |
| 2026-10-28 | Case et aperçu de l'email au conducteur sur le récap, sans étape de plus | Le gestionnaire voit l'email avant de cliquer, sans fenêtre de confirmation : « J'ai désigné sur l'ANTAI » reste l'unique clic. L'aperçu se masque quand la case est décochée. L'email part au nom de l'entreprise, sans logo Désigno. Validé par l'utilisateur. |
| 2026-10-29 | Bouton « Exporter en CSV » cadenassé en Free, sur la liste des avis | Le même bouton secondaire en Free et en Pro, à côté de « Déposer un avis », avec un cadenas `#646464` après le libellé, comme « Demande à Désigno ». En Free, il ouvre une fenêtre avec le cadenas Pro « Export CSV », sur le modèle du 4ᵉ véhicule refusé. Validé par l'utilisateur. |
| 2026-10-29 | Rapport mensuel PDF : tuiles, puis échéances dépassées, plus verbalisés et fiches incomplètes | Le PDF reprend la grammaire du tableau de bord pour que la direction le lise sans compte : les tuiles d'abord, le rouge pour les échéances manquées, le vert pour les amendes évitées. Les listes s'arrêtent sur « et n autres » pour tenir en 2 pages. L'email, au nom de l'entreprise comme celui au conducteur, n'a ni logo, ni lien, ni bouton. Validé par l'utilisateur. |
