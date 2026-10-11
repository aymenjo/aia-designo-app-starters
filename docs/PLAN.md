# Plan : Désigno

> PRD source : `docs/PRD.md`

## Décisions architecturales

Décisions durables qui s'appliquent à toutes les phases :

- **Stack** : Next.js (TypeScript) hébergé sur Vercel. Supabase pour Postgres, Auth, Storage et RLS. Stripe pour Checkout, Billing, les factures et le portail client. Resend pour tous les emails, y compris le lien de connexion via le SMTP Supabase. API Claude pour lire les avis (vision, sortie structurée avec une confiance par champ). Composio pour les comptes Gmail et Google Calendar connectés par le client. Claude Managed Agents pour « Demande à Désigno » : un agent dont la configuration est versionnée dans le dépôt, sans outils intégrés (terminal, fichiers, web désactivés), avec uniquement des outils définis et exécutés par Désigno. Une conversation correspond à une session Managed Agents.
- **Nommage** : vocabulaire français du métier pour les routes, tables, colonnes et statuts, sans accents dans le code. Le vocabulaire technique (session, webhook, cron) reste en anglais.
- **Routes** :
  - Publiques : `/` (landing), `/connexion`, `/connexion/lien-invalide`
  - Application : `/tableau-de-bord`, `/avis`, `/avis/nouveau`, `/avis/:id`, `/avis/:id/recap`, `/avis/emails-non-exploitables`, `/flotte/vehicules`, `/flotte/vehicules/:id`, `/flotte/conducteurs`, `/flotte/conducteurs/:id`, `/flotte/planning`, `/flotte/import`, `/rapports`, `/parametres/entreprise`, `/parametres/integrations`, `/parametres/abonnement`, `/parametres/compte`
  - Machines : `/api/webhooks/stripe`, `/api/webhooks/composio`, `/api/cron/alertes`, `/api/cron/rapport-mensuel`, `/api/agent` (envoi d'un message, réponse en flux avec les étapes), `/api/cron/purge-conversations`
  - Liens cités par l'agent : `/avis/:id`, `/flotte/vehicules/:id`, `/flotte/conducteurs/:id`, et pour une affectation `/flotte/planning?vehicule=:id&date=AAAA-MM-JJ`
- **Schéma (modèles clés)** :
  - `entreprise` : 1–1 avec l'utilisateur Supabase Auth. Contient la raison sociale, le représentant légal (nom, prénom, fonction), le SIREN, le n° de TVA, l'adresse du siège, les emails direction (≤ 3), le `plan` (`free` | `pro`) et l'état de l'abonnement Stripe (client, abonnement, fin de période, date d'échec de paiement).
  - `vehicule` : plaque normalisée, unique par entreprise. Contient le modèle, le type (`attitre` | `pool`), `lecture_seule` et `archive_le`.
  - `conducteur` : civilité, nom, prénom, date de naissance, adresse, n° de permis (unique par entreprise), date de délivrance, email facultatif, et deux champs facultatifs en plus (lieu de naissance, catégorie de permis). Contient aussi `archive_le`.
  - `affectation` : véhicule, conducteur, `debut`, `fin` facultative. Une contrainte en base interdit tout chevauchement **sur un même véhicule**. Un même conducteur peut cumuler un véhicule attitré et un véhicule de pool.
  - `avis` : n° d'avis (unique par entreprise), plaque lue, véhicule (facultatif, sinon « Véhicule inconnu »), date et heure de l'infraction, lieu, infraction, montant en centimes, date d'envoi, `echeance` dérivée, `statut`, motif de classement, conducteur validé, `designe_le`, `verrouille`, mois de quota, source (`depot` | `gmail`), fichier stocké, références Gmail, confiances par champ.
  - `alerte_envoyee` : un avis et un seuil (15 | 7 | 2), avec une contrainte d'unicité pour garantir l'idempotence.
  - `email_non_exploitable`, `connexion_google` (service, compte connecté Composio, libellé, agenda, état), `evenement_agenda`, `rapport_mensuel`.
  - `conversation` (session Managed Agents, élément d'origine, début, première demande), `message` (rôle, contenu, éléments cités), `recapitulatif` (statut `propose` | `applique` | `annule` | `remplace` | `expire`, `applique_le`, lignes numérotées : opération, élément visé, avant/après, motif de refus), `usage_agent` (entreprise, mois, nombre de demandes ; séparé des messages pour ne pas dépendre de la purge).
- **Statuts de l'avis** : `a_traiter` → `a_valider` (tous les champs remplis et les champs rouges confirmés) → `designe` (uniquement via « J'ai désigné sur l'ANTAI »). `classe` est possible depuis tout statut, avec un motif. Rouvrir un avis le fait repasser en `a_valider`.
- **Règles métier transverses** :
  - L'échéance vaut la date d'envoi plus 45 jours calendaires. Les J-n sont calculés à l'heure de Paris (Europe/Paris).
  - Les euros évités ne sont jamais stockés : 675 € par avis `designe` dont `designe_le` est au plus tard le jour de l'échéance. Ils sont donc recalculés quand un avis est rouvert.
  - Les plaques sont acceptées au format AB-123-CD ou 123 ABC 45, et stockées en majuscules avec tirets.
  - Les champs requis pour la fiche conducteur complète, la fiche entreprise complète et le récap sont définis à un seul endroit.
  - Format fr-FR : dates JJ/MM/AAAA, heures sur 24 h, montants au format « 135,00 € ».
  - Les règles d'écriture de la flotte (format et unicité de plaque, unicité du permis, chevauchement, fin obligatoire sur un véhicule de pool, limites Free) et leurs messages sont définies une seule fois côté serveur, et appelées par les écrans, l'import CSV et l'agent.
- **Authentification et isolation** : lien magique Supabase valable 15 min, à usage unique, et session de 30 jours. L'inscription se fait par la connexion : l'entreprise est créée au premier login. RLS par entreprise sur toutes les tables. Les signatures des webhooks Stripe et Composio sont vérifiées.
- **Plans** : `entreprise.plan` est la source de vérité, mise à jour uniquement par les webhooks Stripe (seed en dev). Chaque fonction Pro livre aussi sa version Free cadenassée et son arrêt au retour en Free.
- **Agent** :
  - Les outils de lecture sont exécutés par le serveur Désigno avec la session du gestionnaire (RLS) : véhicules, conducteurs, affectations, avis, archivés compris.
  - Un seul outil d'écriture, qui se contente de proposer : il valide chaque ligne avec les règles d'écriture partagées et enregistre le récapitulatif. « Confirmer » revalide tout, revérifie le plan Pro et applique en une seule transaction.
  - Aucun outil ne permet de désigner, valider un conducteur, classer, rouvrir, supprimer, écrire à quelqu'un, ni modifier l'entreprise ou l'abonnement.
  - Avant d'envoyer un nouveau message, le serveur résout ou interrompt les appels d'outil restés en attente.
  - Les demandes sont comptées par Désigno à l'envoi d'un message (mois calendaire, heure de Paris).
- **Tâches planifiées** : tâches Vercel, une fois par jour au plus (plan Hobby) : les alertes (le matin, heure de Paris), le rapport mensuel (le 1er du mois) et la purge des conversations de plus de 30 jours (en base et chez Anthropic). Pas de tâche planifiée pour Gmail : la relève passe par le déclencheur Composio.
- **Tests** : tests unitaires des règles métier (échéance, plaque, SIREN/TVA, chevauchement, seuils d'alerte, euros évités, quotas) et un test E2E par phase sur son parcours démontrable.
- **Règle d'extension** : toute phase qui ajoute une donnée ou une connexion externe l'ajoute aussi à la suppression de compte (phase 20) et au retour en Free (phase 19).

### Risques et points ouverts

- **Champs ANTAI** : à vérifier sur le vrai formulaire avec un vrai avis. Si le lieu de naissance ou la catégorie de permis sont exigés, il suffit de les ajouter à la liste des champs requis.
- **Vérification Google** : la lecture Gmail utilise un scope restreint. Avant le lancement public, il faut un client OAuth Désigno branché dans Composio, puis la vérification Google avec audit de sécurité CASA. On utilise l'app gérée par Composio en développement et en bêta.
- **RGPD** : l'information des conducteurs et la durée de conservation ne sont couvertes par aucune user story. À compléter avec /cadre, puis /planifie en mode extension. L'information des conducteurs doit aussi mentionner les conversations avec l'agent (effacées au bout de 30 jours) et le traitement hors UE par l'API Claude (inférence fixable seulement à `us` ou `global`).
- **Avis ANTAI reçus sous forme de lien** : ils arrivent sans pièce jointe et tombent dans « Emails non exploitables ».
- **Managed Agents en bêta** : l'API peut changer ; la latence des allers-retours d'outils est à mesurer face à l'objectif de 30 s ; le coût par demande (jetons et exécution) est à suivre en bêta pour valider la limite de 100.
- **Texte des avis relu par l'agent** : le lieu et l'infraction lus par l'IA peuvent contenir une instruction cachée ; rien ne s'applique sans « Confirmer ».

---

## Phase 1 : Socle : inscription et connexion par lien magique

**User stories** : US-2, US-3, US-4

### Ce qu'on livre
L'application est déployée en production. Le visiteur saisit son email sur `/connexion`, reçoit un lien, clique et arrive sur un `/tableau-de-bord` vide. Sa première connexion crée son entreprise. Un lien expiré ou déjà utilisé mène à une page claire avec un bouton « Recevoir un nouveau lien ».

### Critères d'acceptation
- [ ] Un email inconnu crée le compte et l'entreprise ; un email connu ouvre le même compte
- [ ] Le lien expire après 15 minutes et ne sert qu'une fois
- [ ] Un lien expiré ou déjà utilisé affiche un message et un bouton qui envoie un nouveau lien
- [ ] La session reste ouverte 30 jours sur un même appareil, et la déconnexion est possible
- [ ] Sans session, toute route de l'application redirige vers `/connexion`
- [ ] Un test automatisé avec deux comptes prouve qu'aucun ne voit les données de l'autre (RLS)
- [ ] La CI exécute les tests unitaires et E2E, et le déploiement de production est en place

## Bloquée par
Aucune — démarrable immédiatement

---

## Phase 2 : Fiche entreprise

**User stories** : US-5, US-6

### Ce qu'on livre
Sur `/parametres/entreprise`, le gestionnaire saisit la raison sociale, le représentant légal, le SIREN, le n° de TVA et l'adresse du siège. Les erreurs sont signalées dès la saisie. Un état « complète / incomplète » est exposé et sera réutilisé par le récap et par le passage en Pro.

### Critères d'acceptation
- [ ] Tous les champs se saisissent et se modifient
- [ ] Un SIREN de format invalide (pas exactement 9 chiffres, ou clé de contrôle fausse) est signalé dès la saisie et bloque l'enregistrement
- [ ] Un n° de TVA mal formé ou incohérent avec le SIREN est signalé dès la saisie
- [ ] La fiche indique si elle est complète et liste les champs manquants

## Bloquée par
- Phase 1

---

## Phase 3 : Véhicules

**User stories** : US-9, US-10, US-22 (l'état vide sera complété en phase 6)

### Ce qu'on livre
Sur `/flotte/vehicules`, le gestionnaire ajoute, modifie et archive un véhicule (plaque, modèle, attitré ou pool). Sans véhicule, un état vide l'invite à ajouter le premier.

### Critères d'acceptation
- [ ] Les plaques AB-123-CD et 123 ABC 45 sont acceptées, avec ou sans espaces, tirets ou minuscules, et affichées en majuscules avec tirets
- [ ] Une plaque mal formée ou déjà présente dans l'entreprise bloque l'enregistrement, avec un message
- [ ] Un véhicule archivé disparaît de la liste
- [ ] Sans véhicule, l'état vide propose « Ajouter un véhicule »

## Bloquée par
- Phase 1

---

## Phase 4 : Conducteurs

**User stories** : US-11, US-12

### Ce qu'on livre
Sur `/flotte/conducteurs`, le gestionnaire remplit la fiche conducteur : civilité, nom, prénom, date de naissance, adresse, n° et date de délivrance du permis, email facultatif. Les champs facultatifs en plus sont le lieu de naissance et la catégorie de permis. Un badge « Fiche complète » ou « Incomplète · N champs » s'affiche, avec la liste des champs manquants.

### Critères d'acceptation
- [ ] Une fiche incomplète peut être enregistrée (le nom et le prénom suffisent)
- [ ] Le badge vert « Fiche complète » apparaît quand tous les champs requis sont remplis (l'email n'en fait pas partie) ; sinon un badge orange « Incomplète » indique le nombre de champs manquants, et la fiche les liste
- [ ] Ajouter un champ à la liste des champs requis (définie à un seul endroit) change le badge sans autre modification
- [ ] Le n° de permis est unique dans l'entreprise
- [ ] Un conducteur archivé disparaît de la liste

## Bloquée par
- Phase 1

---

## Phase 5 : Affectations et planning

**User stories** : US-13, US-14, US-15, US-16, US-17

### Ce qu'on livre
Le gestionnaire enregistre une affectation : conducteur, véhicule, début et fin facultative. Les chevauchements sont refusés et le conflit est nommé. Il peut clôturer une affectation ouverte. `/flotte/planning` affiche une vue chronologique par véhicule, à la semaine ou au mois, avec un filtre par conducteur. Un véhicule ou un conducteur qui a un historique ne peut qu'être archivé.

### Critères d'acceptation
- [ ] Pour un véhicule attitré, la fin est vide par défaut ; pour un véhicule de pool, l'heure de fin est obligatoire
- [ ] Une affectation qui en chevauche une autre sur le même véhicule est refusée dans 100 % des cas, avec un message du type « Conflit avec : Karim B. sur AB-123-CD du 03/03 08:00 au 03/03 18:00 »
- [ ] Le refus est garanti par une contrainte en base, pas seulement par l'interface
- [ ] Une affectation ouverte se clôture en fixant sa fin
- [ ] Le planning par véhicule s'affiche à la semaine et au mois, et se filtre par conducteur
- [ ] Un véhicule ou un conducteur avec des affectations ne peut pas être supprimé, seulement archivé ; archivé, il disparaît des listes et des sélecteurs mais reste visible dans le planning passé

## Bloquée par
- Phase 3, Phase 4

---

## Phase 6 : Import CSV de la flotte

**User stories** : US-18, US-19, US-20, US-21 (et la fin de US-22)

### Ce qu'on livre
Sur `/flotte/import`, deux modèles CSV sont téléchargeables, un pour les véhicules et un pour les conducteurs. Le gestionnaire dépose un fichier et voit un aperçu des lignes valides et des lignes en erreur, avec leur motif. Seules les lignes valides sont importées. Les colonnes « conducteur attitré » et « attitré depuis le » créent les affectations. L'état vide des véhicules propose maintenant « Importer un fichier ».

### Critères d'acceptation
- [ ] Les deux modèles se téléchargent et se réimportent tels quels
- [ ] L'aperçu liste chaque ligne en erreur avec son motif (plaque invalide, doublon, champ manquant, conducteur attitré introuvable, conflit d'affectation)
- [ ] Seules les lignes valides sont importées ; les plaques et permis déjà présents sont ignorés et signalés
- [ ] Un fichier conforme de 15 véhicules et 15 conducteurs s'importe en une seule opération
- [ ] « Conducteur attitré » (email ou n° de permis) crée une affectation ouverte qui débute à la date « attitré depuis le », ou à la date d'import si elle est vide

## Bloquée par
- Phase 5

---

## Phase 7 : Dépôt et saisie manuelle d'un avis, échéance

**User stories** : US-23, US-24, US-30, US-31

### Ce qu'on livre
Sur `/avis/nouveau`, le gestionnaire dépose un fichier depuis son ordinateur. Sur téléphone, l'appareil photo s'ouvre directement. L'avis est créé « À traiter ». Sur `/avis/:id`, l'image zoomable s'affiche à côté du formulaire (n° d'avis, plaque, date et heure, lieu, infraction, montant, date d'envoi), que le gestionnaire remplit à la main. L'échéance est calculée et l'avis est rattaché au véhicule par sa plaque. `/avis` affiche une liste simple.

### Critères d'acceptation
- [ ] Les fichiers PDF, JPG, PNG et HEIC jusqu'à 10 Mo sont acceptés, un fichier par avis ; les autres sont refusés avec un message
- [ ] Un HEIC s'affiche dans tous les navigateurs
- [ ] Sur téléphone, l'écran de dépôt ouvre l'appareil photo directement, sans défilement horizontal
- [ ] Tous les champs se saisissent à la main, y compris pour un avis entièrement illisible
- [ ] L'échéance s'affiche « avant le JJ/MM/AAAA · J-n », vaut la date d'envoi plus 45 jours, et est recalculée immédiatement si la date d'envoi change
- [ ] La plaque saisie rattache l'avis au véhicule correspondant
- [ ] L'avis passe « À valider » quand tous les champs sont remplis

## Bloquée par
- Phase 3

---

## Phase 8 : Suivi des avis : tri, filtre, échéance dépassée, doublons

**User stories** : US-32, US-37, US-38

### Ce qu'on livre
`/avis` trie les avis par échéance la plus proche et les filtre par statut. Le badge rouge « Échéance dépassée » apparaît sans changer le statut. Un n° d'avis déjà enregistré est refusé, avec un lien vers l'avis existant.

### Critères d'acceptation
- [ ] La liste est triée par échéance croissante et filtrable par statut
- [ ] Un avis ouvert dont l'échéance est passée porte le badge « Échéance dépassée », sans changement de statut
- [ ] Quand le n° d'un avis existe déjà dans l'entreprise, l'avis en cours est abandonné et le message « Cet avis existe déjà » renvoie vers l'existant ; un second avis n'est jamais créé
- [ ] L'unicité du n° d'avis par entreprise est garantie en base

## Bloquée par
- Phase 7

---

## Phase 9 : Lecture IA de l'avis

**User stories** : US-28, US-29

### Ce qu'on livre
Après le dépôt, l'API Claude lit le fichier et pré-remplit les 7 champs, chacun avec un niveau de confiance vert, orange ou rouge. Le gestionnaire vérifie à côté de l'image et confirme les champs rouges. Un jeu d'évaluation de 20 avis réels anonymisés est constitué.

### Critères d'acceptation
- [ ] Après le dépôt, les 7 champs sont pré-remplis sans action du gestionnaire
- [ ] Chaque champ affiche un niveau vert, orange ou rouge ; un champ non lu est rouge et vide
- [ ] L'avis ne passe « À valider » que si tous les champs sont remplis et les champs rouges confirmés
- [ ] Si le service IA échoue, l'avis reste créé et se saisit à la main
- [ ] Le n° lu déclenche le contrôle de doublon de la phase 8
- [ ] Sur le jeu de 20 avis, au moins 90 % des champs sont corrects, mesurés par un script d'évaluation qu'on peut relancer

## Bloquée par
- Phase 8

---

## Phase 10 : Proposition du conducteur (cas nominal) et validation

**User stories** : US-33, US-41

### Ce qu'on livre
Sur un avis « À valider » rattaché à un véhicule, Désigno propose le conducteur de l'affectation qui couvre la date et l'heure de l'infraction. Le gestionnaire valide avec « Valider ce conducteur » ou choisit un autre conducteur.

### Critères d'acceptation
- [ ] Quand une affectation couvre la date et l'heure de l'infraction, son conducteur est proposé dans 100 % des cas (tests aux bornes, affectation ouverte)
- [ ] La validation passe toujours par « Valider ce conducteur », même s'il n'y a qu'un candidat ; rien n'est validé automatiquement
- [ ] Le gestionnaire peut choisir un autre conducteur actif ; les conducteurs archivés sont exclus
- [ ] Le conducteur validé reste modifiable tant que l'avis n'est pas désigné

## Bloquée par
- Phase 5, Phase 7

---

## Phase 11 : Récap ANTAI et passage en « Désigné »

**User stories** : US-42, US-43, US-44, US-45

### Ce qu'on livre
`/avis/:id/recap` s'ouvre une fois le conducteur validé et les fiches complètes. Si une fiche est incomplète, ses champs manquants se complètent sur place. Le récap a 3 blocs (Avis, Entreprise, Conducteur), un bouton « Copier » par champ et un lien vers l'ANTAI. Le bouton « J'ai désigné sur l'ANTAI » passe l'avis en « Désigné ».

### Critères d'acceptation
- [ ] Si la fiche conducteur ou la fiche entreprise est incomplète, les champs manquants s'affichent et se complètent sans quitter l'avis, puis le récap s'ouvre
- [ ] Les blocs contiennent : Avis (n°, date et heure, plaque) ; Entreprise (raison sociale, SIREN, représentant légal) ; Conducteur (civilité, nom, prénom, date de naissance, adresse, n° de permis, date de délivrance), avec les dates au format JJ/MM/AAAA
- [ ] Chaque champ se copie en un clic, avec un retour visuel « Copié »
- [ ] Un lien ouvre le site de l'ANTAI dans un nouvel onglet
- [ ] L'avis ne passe « Désigné » que par le clic « J'ai désigné sur l'ANTAI », et la date du clic est enregistrée
- [ ] Un test E2E du chemin nominal (avis lisible, affectation existante) mène du dépôt au récap prêt en moins de 3 minutes

## Bloquée par
- Phase 2, Phase 9, Phase 10

---

## Phase 12 : Classer et rouvrir un avis

**User stories** : US-39, US-40

### Ce qu'on livre
Le gestionnaire classe un avis depuis n'importe quel statut, avec un motif obligatoire. Il rouvre un avis désigné ou classé, qui repasse alors « À valider ».

### Critères d'acceptation
- [ ] Les motifs sont : avis contesté, véhicule volé ou plaque usurpée, avis non soumis à désignation, autre (texte libre obligatoire)
- [ ] Un avis classé sort des avis à traiter et ne porte plus le badge « Échéance dépassée »
- [ ] Rouvrir un avis le repasse « À valider » et efface sa date de désignation
- [ ] Le filtre par statut propose « Classé »

## Bloquée par
- Phase 11

---

## Phase 13 : Proposition : cas dégradés

**User stories** : US-34, US-35, US-36

### Ce qu'on livre
Sans affectation qui couvre l'infraction, Désigno affiche « Aucune affectation à cette date » et donne en indices le conducteur d'avant et celui d'après. Le gestionnaire choisit lui-même, puis peut enregistrer l'affectation manquante en un clic. Quand la plaque ne correspond à aucun véhicule, l'avis porte le badge « Véhicule inconnu » : le gestionnaire crée le véhicule depuis l'avis ou classe l'avis.

### Critères d'acceptation
- [ ] Sans affectation couvrante, le message s'affiche avec en indices le dernier conducteur avant et le premier après sur ce véhicule, s'ils existent
- [ ] Après validation, Désigno propose d'enregistrer l'affectation manquante en un clic ; elle est refusée si elle chevauche une autre affectation
- [ ] « Véhicule inconnu » permet de créer le véhicule avec la plaque pré-remplie ; l'avis lui est alors rattaché et la proposition relancée
- [ ] « Véhicule inconnu » permet aussi de classer l'avis directement

## Bloquée par
- Phase 12

---

## Phase 14 : Alertes email J-15 / J-7 / J-2

**User stories** : US-48, US-49

### Ce qu'on livre
Une tâche planifiée tourne chaque matin, heure de Paris. Elle envoie par entreprise un seul email, qui regroupe les avis ouverts atteignant J-15, J-7 ou J-2 ce jour-là, avec un lien vers chacun.

### Critères d'acceptation
- [ ] Un avis ni désigné ni classé déclenche un email à J-15, J-7 et J-2
- [ ] Une entreprise reçoit au plus un email par jour, qui regroupe tous ses avis concernés
- [ ] Un seuil déjà passé à la création de l'avis n'est pas rattrapé
- [ ] Un avis désigné ou classé ne déclenche plus aucun email ; rouvert, il redevient concerné par les seuils suivants
- [ ] Relancer la tâche le même jour n'envoie aucun doublon
- [ ] Les trois seuils sont testés avec une horloge simulée

## Bloquée par
- Phase 12

---

## Phase 15 : Tableau de bord et liste de démarrage

**User stories** : US-7, US-51, US-52

### Ce qu'on livre
Le `/tableau-de-bord` affiche une liste de démarrage en 3 étapes tant qu'elle n'est pas terminée. On y trouve aussi 4 tuiles, la liste des 5 prochaines échéances, et un affichage soigné sur téléphone.

### Critères d'acceptation
- [ ] La liste de démarrage (fiche entreprise complète, au moins un véhicule, premier avis) se coche automatiquement et disparaît une fois terminée
- [ ] Les tuiles affichent : avis à traiter (« À traiter » + « À valider »), échéances à 15 jours ou moins, avis désignés, et « amendes de non-désignation évitées » (mois en cours et cumul)
- [ ] Chaque avis désigné au plus tard le jour de son échéance ajoute 675 €, tout autre avis 0 € ; rouvrir un avis recalcule le total
- [ ] Les 5 prochaines échéances sont listées sous les tuiles
- [ ] Le tableau de bord s'utilise sur téléphone sans défilement horizontal

## Bloquée par
- Phase 12

---

## Phase 16 : Landing page

**User stories** : US-1

### Ce qu'on livre
La page `/` présente la promesse, les 4 étapes, les tarifs Free et Pro et une FAQ, avec un appel à l'action vers `/connexion`.

### Critères d'acceptation
- [ ] Les 4 étapes reprennent les libellés du PRD
- [ ] Les tarifs indiquent Free (0 €) et Pro (49 € HT/mois, soit 58,80 € TTC), avec l'argument « une seule amende évitée paie plus d'un an d'abonnement »
- [ ] La FAQ répond au minimum à « Désigno désigne-t-il à ma place ? », « Mes données sont-elles protégées ? » et « Que se passe-t-il si je dépasse le plan Free ? »
- [ ] La FAQ répond aussi à « L'agent peut-il modifier mes données sans mon accord ? »
- [ ] La page est responsive

## Bloquée par
Aucune — démarrable immédiatement

---

## Phase 17 : Plan Free : quotas, verrouillage, usage, cadenas

**User stories** : US-57, US-58, US-59, US-60

### Ce qu'on livre
Les limites Free s'appliquent : 3 véhicules actifs, 5 avis par mois calendaire comptés au dépôt, et un historique visible sur 3 mois (masqué, jamais supprimé). À partir du 6e avis du mois, l'avis est enregistré « Verrouillé ». Le gestionnaire y saisit la plaque et la date d'envoi, ce qui calcule l'échéance et active les alertes. La lecture IA, la proposition et le récap restent verrouillés. Un compteur d'usage est toujours visible. Le principe du cadenas « fonction Pro » est posé sur `/parametres/abonnement`.

### Critères d'acceptation
- [ ] Les compteurs « 2/3 véhicules » et « 4/5 avis ce mois-ci » sont toujours visibles
- [ ] L'ajout manuel d'un 4e véhicule est refusé, avec une invitation à passer en Pro ; à l'import, les véhicules au-delà du 3e sont listés comme non importés, avec la même invitation
- [ ] Le 6e avis du mois est enregistré « Verrouillé » ; son échéance est calculée et ses alertes J-15, J-7 et J-2 partent
- [ ] Sur un avis verrouillé, la lecture IA, la proposition et le récap sont indisponibles, avec une explication
- [ ] Le 1er du mois suivant, les avis verrouillés se déverrouillent dans la limite du quota du nouveau mois, en commençant par l'échéance la plus proche, et comptent dans ce quota
- [ ] En Free, les avis de plus de 3 mois sont masqués, jamais supprimés
- [ ] Les fonctions Pro apparaissent avec un cadenas et une phrase d'explication

## Bloquée par
- Phase 6, Phase 11, Phase 14

---

## Phase 18 : Passage en Pro et portail client

**User stories** : US-61, US-62

### Ce qu'on livre
Le bouton « Passer en Pro » demande une fiche entreprise complète, puis ouvre Stripe Checkout (carte, 49 € HT + TVA). Le webhook passe le compte en Pro immédiatement. Une facture mensuelle à la raison sociale, avec le SIREN et le n° de TVA, est envoyée par email. Le portail client Stripe permet de changer de carte, de télécharger les factures et d'annuler.

### Critères d'acceptation
- [ ] Si la fiche entreprise est incomplète, le bouton est indisponible et les champs manquants sont affichés
- [ ] Après paiement, le compte est Pro immédiatement (webhook signé et idempotent)
- [ ] La facture reçue par email est au nom de la raison sociale, avec le SIREN et le n° de TVA
- [ ] Depuis le portail : changer de carte, télécharger une facture, annuler ; l'annulation prend effet à la fin de la période payée
- [ ] En Pro, les véhicules et les avis sont illimités, les avis verrouillés sont déverrouillés et tout l'historique est visible
- [ ] Les parcours sont testés en mode test Stripe

## Bloquée par
- Phase 2, Phase 17

---

## Phase 19 : Échec de paiement et retour en Free

**User stories** : US-63, US-64, US-65

### Ce qu'on livre
Un échec de paiement déclenche un email et un bandeau. Sans régularisation sous 7 jours, le compte repasse en Free. Au retour en Free, après un impayé ou une annulation, rien n'est supprimé : le gestionnaire choisit ses 3 véhicules actifs, et les autres passent en lecture seule. Repasser en Pro restaure tout.

### Critères d'acceptation
- [ ] Un échec de paiement déclenche un email au gestionnaire et un bandeau persistant, avec un lien vers le portail
- [ ] Sans régularisation sous 7 jours, le compte repasse automatiquement en Free
- [ ] Au retour en Free, aucune donnée n'est supprimée, et l'écran de choix des 3 véhicules actifs s'affiche à la connexion suivante
- [ ] Les véhicules non choisis passent en lecture seule ; leurs nouveaux avis sont acceptés mais verrouillés
- [ ] Repasser en Pro rend tout l'historique et réactive tous les véhicules

## Bloquée par
- Phase 18

---

## Phase 20 : Suppression de compte

**User stories** : US-8

### Ce qu'on livre
Sur `/parametres/compte`, le gestionnaire supprime son compte après avoir confirmé en saisissant la raison sociale. Toutes les données et tous les fichiers sont effacés, l'abonnement Stripe est annulé et l'utilisateur est supprimé.

### Critères d'acceptation
- [ ] La suppression n'est possible qu'après la saisie exacte de la raison sociale (ou de l'email si la fiche n'a pas de raison sociale)
- [ ] Un test vérifie qu'il ne reste aucune ligne ni aucun fichier de l'entreprise
- [ ] L'abonnement Stripe est annulé
- [ ] Le même email peut ensuite créer un compte vierge

## Bloquée par
- Phase 18

---

## Phase 21 : Email au conducteur (Pro)

**User stories** : US-46, US-47

### Ce qu'on livre
Au clic sur « J'ai désigné sur l'ANTAI », la case « Prévenir le conducteur » est cochée par défaut. Le gestionnaire voit un aperçu de l'email, puis l'email part au conducteur, et les réponses arrivent chez le gestionnaire. L'email reprend les faits et annonce un nouvel avis au nom du conducteur, sans pièce jointe.

### Critères d'acceptation
- [ ] La case est cochée par défaut ; elle est désactivée avec la mention « email manquant » si le conducteur n'a pas d'email
- [ ] Un aperçu de l'email s'affiche avant l'envoi
- [ ] L'email reprend la date, l'heure, le lieu, le véhicule, l'infraction et le montant, annonce l'avis au nom du conducteur, et ne contient aucune pièce jointe
- [ ] Une réponse du conducteur arrive dans la boîte du gestionnaire
- [ ] En Free, la case est cadenassée avec une explication ; au retour en Free, plus aucun email ne part

## Bloquée par
- Phase 11, Phase 19

---

## Phase 22 : Rappels Google Calendar (Pro)

**User stories** : US-50

### Ce qu'on livre
Le gestionnaire connecte Google Calendar via Composio depuis `/parametres/integrations`. Désigno crée un agenda « Désigno ». Chaque avis ouvert y a un événement sur la journée à J-2, synchronisé avec le cycle de vie de l'avis.

### Critères d'acceptation
- [ ] La connexion crée l'agenda « Désigno »
- [ ] Chaque avis ouvert a un événement sur la journée à J-2, intitulé « Désigner – AB-123-CD – avant le 18/11 », avec le lien vers l'avis
- [ ] L'événement est déplacé si l'échéance change, supprimé quand l'avis passe « Désigné » ou « Classé », et recréé si l'avis est rouvert
- [ ] En Free, la connexion est cadenassée ; au retour en Free, aucun nouvel événement n'est créé
- [ ] La suppression de compte révoque le compte connecté

## Bloquée par
- Phase 12, Phase 19

---

## Phase 23 : Relève Gmail (Pro)

**User stories** : US-25, US-26, US-27

### Ce qu'on livre
Le gestionnaire connecte Gmail via Composio et choisit un libellé existant. Le déclencheur Composio appelle le webhook Désigno à chaque nouvel email. Chaque pièce jointe PDF ou image devient un avis, lu par l'IA. Les emails sans pièce jointe exploitable vont dans `/avis/emails-non-exploitables`. Si la connexion est interrompue, un bandeau rouge s'affiche et un email part au gestionnaire.

### Critères d'acceptation
- [ ] Un email placé dans le libellé avec un avis en pièce jointe apparaît comme avis « À traiter » en moins de 20 minutes
- [ ] Une pièce jointe donne un avis ; seules les pièces jointes PDF et image sont traitées ; l'email d'origine est consultable depuis l'avis
- [ ] Un avis déjà enregistré est ignoré sans créer d'avis, et un même email reçu deux fois par le webhook ne crée rien de plus
- [ ] Les emails sans pièce jointe exploitable apparaissent dans « Emails non exploitables », avec « Déposer manuellement » et « Ignorer »
- [ ] Désigno ne lit que le libellé choisi et n'envoie jamais rien depuis la boîte
- [ ] Si la connexion est interrompue, un bandeau rouge reste affiché jusqu'à la reconnexion et un email part au gestionnaire
- [ ] En Free, la fonction est cadenassée ; au retour en Free, la relève s'arrête ; la suppression de compte révoque le compte connecté

## Bloquée par
- Phase 9, Phase 19

---

## Phase 24 : Export CSV des avis (Pro)

**User stories** : US-53

### Ce qu'on livre
Le gestionnaire exporte l'historique complet des avis en CSV.

### Critères d'acceptation
- [ ] Le fichier contient tous les avis : n°, plaque, date et heure, lieu, infraction, montant, date d'envoi, échéance, statut, motif de classement, conducteur désigné, date de désignation
- [ ] Le fichier s'ouvre correctement dans Excel en français (accents et colonnes)
- [ ] En Free, la fonction est cadenassée avec une explication

## Bloquée par
- Phase 12, Phase 19

---

## Phase 25 : Rapport mensuel PDF (Pro)

**User stories** : US-54, US-55, US-56

### Ce qu'on livre
Le gestionnaire renseigne jusqu'à 3 adresses « direction ». Le 1er de chaque mois, une tâche planifiée génère le PDF du mois écoulé. Elle l'envoie aux adresses direction, avec le gestionnaire en copie, et l'archive dans `/rapports`.

### Critères d'acceptation
- [ ] Jusqu'à 3 adresses direction se saisissent dans la fiche entreprise
- [ ] Le PDF fait 1 à 2 pages et contient : avis reçus, désignés, classés, échéances dépassées, euros évités (mois et cumul), véhicules et conducteurs les plus verbalisés, fiches incomplètes
- [ ] Un mois sans avis produit quand même un rapport, avec la mention « Aucun avis ce mois-ci »
- [ ] Le 1er du mois, les adresses direction et le gestionnaire reçoivent le PDF
- [ ] Les rapports passés se téléchargent depuis `/rapports`
- [ ] En Free, la fonction est cadenassée ; au retour en Free, plus aucun rapport n'est envoyé

## Bloquée par
- Phase 15, Phase 19

---

## Phase 26 : Demande à Désigno : question et réponse citée

**User stories** : US-66, US-67, US-68, US-69, US-82, US-83

### Ce qu'on livre
Sur ordinateur, un bouton présent sur tous les écrans ouvre un panneau latéral. Une nouvelle conversation affiche 3 exemples cliquables. L'agent consulte les véhicules, conducteurs, affectations et avis de l'entreprise, archivés compris, et répond en français en citant chaque élément avec un lien. « Nouvelle conversation » repart à zéro. En Free, la fonction est cadenassée. Un compte de démonstration et un jeu de 30 questions mesurent la justesse et le temps de réponse.

### Critères d'acceptation
- [ ] Le bouton est présent sur tous les écrans de l'application sur ordinateur, et ouvre le panneau sans changer d'écran
- [ ] Une nouvelle conversation affiche les 3 exemples du PRD, envoyés d'un clic
- [ ] Les réponses sont en français, courtes, en liste ou en tableau dès qu'il y a plusieurs éléments, aux formats JJ/MM/AAAA, 24 h et « 135,00 € »
- [ ] Chaque réponse fondée sur des données cite au moins un élément ; chaque élément cité est un lien qui ouvre la bonne fiche, et une affectation ouvre le planning du véhicule à sa date
- [ ] Sans donnée pour répondre, l'agent le dit (« Aucune affectation sur AB-123-CD le 12/03 ») au lieu de supposer
- [ ] L'agent ne voit que les données de l'entreprise du gestionnaire (test à deux comptes)
- [ ] Une demande coupée en cours de route (onglet fermé, coupure réseau) ne bloque pas la conversation
- [ ] « Nouvelle conversation » démarre une conversation vide, et la précédente est effacée chez Anthropic
- [ ] Une tâche quotidienne efface les conversations de plus de 30 jours, en base et chez Anthropic ; la relancer le même jour ne pose pas de problème
- [ ] Sur le compte de démonstration (15 véhicules, 15 conducteurs, 6 mois), au moins 90 % des 30 questions reçoivent une réponse exacte, et 90 % en moins de 30 s, mesurés par un script qu'on peut relancer
- [ ] En Free, le bouton porte un cadenas et le panneau explique la fonction et invite à passer en Pro ; aucune demande n'est traitée, même par un appel direct au serveur
- [ ] Au retour en Free, plus aucune demande n'est traitée ; la suppression de compte efface les conversations en base et chez Anthropic

## Bloquée par
- Phase 13, Phase 19

---

## Phase 27 : Limite de 100 demandes par mois

**User stories** : US-79, US-80

### Ce qu'on livre
Le panneau affiche en permanence le compteur de demandes du mois. Chaque message envoyé compte pour une demande, y compris un exemple cliqué. À 100, la saisie est désactivée et le panneau indique la date de remise à zéro. Le serveur refuse toute demande au-delà, et le compteur repart à 0 le 1er du mois, heure de Paris.

### Critères d'acceptation
- [ ] Le compteur « N/100 demandes ce mois-ci » est toujours affiché dans le panneau
- [ ] Seuls les messages envoyés comptent, y compris un exemple cliqué ou une demande interrompue
- [ ] À 100, la saisie est désactivée avec le message « Limite atteinte, retour le 01/MM »
- [ ] La 101ᵉ demande est refusée par le serveur, même hors de l'interface
- [ ] Le compteur repart à 0 le 1er du mois, heure de Paris, indépendamment des conversations effacées

## Bloquée par
- Phase 26

---

## Phase 28 : Contexte de l'écran, étape en cours et « Arrêter »

**User stories** : US-70, US-71

### Ce qu'on livre
Ouvert depuis un avis, un véhicule ou un conducteur, le panneau rappelle l'élément en haut, et l'agent comprend « cet avis », « ce véhicule » ou « ce conducteur ». Pendant la recherche, le panneau affiche l'étape en cours. Un bouton « Arrêter » interrompt la demande sans bloquer la conversation.

### Critères d'acceptation
- [ ] Ouvert depuis un avis, un véhicule ou un conducteur, le panneau affiche « Sur : … » avec l'élément concerné
- [ ] « Cet avis », « ce véhicule » et « ce conducteur » désignent l'élément de l'écran ouvert ; sans contexte, l'agent demande lequel
- [ ] Pendant la recherche, l'étape en cours s'affiche (« Je consulte le planning de AB-123-CD… »)
- [ ] « Arrêter » interrompt la demande en quelques secondes et laisse la conversation utilisable

## Bloquée par
- Phase 26

---

## Phase 29 : Récapitulatif de modifications, appliqué tout ou rien

**User stories** : US-72, US-73, US-77

### Ce qu'on livre
Le gestionnaire décrit un changement en une phrase. L'agent prépare toutes les modifications et les présente dans un récapitulatif numéroté, avec l'avant/après de chaque modification. Rien ne change avant « Confirmer », qui revalide tout puis applique en une seule transaction ; « Annuler » abandonne. Une fois appliqué, le récapitulatif affiche sa date.

### Critères d'acceptation
- [ ] L'agent peut proposer seulement : créer, modifier ou archiver un véhicule ou un conducteur ; créer, modifier ou clôturer une affectation
- [ ] Le récapitulatif est numéroté, avec une ligne par modification et l'avant/après pour chaque modification
- [ ] Aucune donnée ne change sans un clic sur « Confirmer » ; « Annuler » abandonne sans rien modifier
- [ ] « Karim part vendredi, passe son camion à Léa » produit une clôture, une nouvelle affectation et un archivage, appliqués en un seul clic
- [ ] Au clic, tout est revalidé : si une ligne n'est plus possible, rien n'est appliqué et un message l'explique
- [ ] Après application, le récapitulatif affiche « Appliqué le JJ/MM/AAAA à HH:MM » et les écrans reflètent aussitôt les changements
- [ ] « Confirmer » et « Annuler » ne comptent pas comme des demandes
- [ ] Un récapitulatif non confirmé n'est plus applicable dès qu'une nouvelle conversation démarre, ou au retour en Free

## Bloquée par
- Phase 26

---

## Phase 30 : Récapitulatif : règles des écrans, ambiguïté, correction

**User stories** : US-74, US-75, US-76

### Ce qu'on livre
Chaque ligne du récapitulatif passe par les mêmes règles que les écrans. Une ligne impossible s'affiche en rouge avec le motif des écrans, et « Confirmer » reste désactivé. « Modifier » permet de préciser en une phrase : l'agent refait le récapitulatif, et l'ancien n'est plus applicable. Quand la demande est ambiguë ou incomplète, l'agent pose une question avant de proposer quoi que ce soit.

### Critères d'acceptation
- [ ] Une ligne impossible (plaque mal formée ou déjà présente, permis déjà présent, chevauchement, fin manquante sur un véhicule de pool) s'affiche en rouge avec le motif exact de l'écran correspondant
- [ ] Tant qu'une ligne est impossible, « Confirmer » est désactivé
- [ ] « Modifier » : le gestionnaire précise en une phrase, l'agent refait le récapitulatif, et l'ancien n'est plus applicable
- [ ] Si la demande peut viser plusieurs éléments (deux Karim) ou s'il manque une information indispensable (une date), l'agent pose une question au lieu de proposer un récapitulatif

## Bloquée par
- Phase 29

---

## Phase 31 : Refus hors rôle

**User stories** : US-78

### Ce qu'on livre
Une demande hors rôle (désigner, valider un conducteur, classer, rouvrir, supprimer, écrire à quelqu'un, modifier l'entreprise ou l'abonnement) reçoit une phrase d'explication et un lien vers l'écran où agir. Une question sans rapport reçoit une réponse fixe. Ces refus reposent sur l'absence d'outil, pas seulement sur les consignes de l'agent, et un jeu de 10 demandes les mesure.

### Critères d'acceptation
- [ ] Chaque refus donne une phrase d'explication et un lien vers l'écran où agir (« Je ne peux pas désigner. Ouvrez l'avis n° … pour valider le conducteur. »)
- [ ] Une demande de suppression est refusée, et l'agent indique qu'il peut seulement archiver
- [ ] Une question sans rapport reçoit « Je réponds seulement sur votre flotte, votre planning et vos avis. »
- [ ] Sur le jeu de 10 demandes hors rôle, 100 % sont refusées avec un lien et aucune donnée n'est modifiée, mesurés par un script qu'on peut relancer
- [ ] Aucun outil de l'agent ne permet ces actions : le refus ne repose pas seulement sur les consignes

## Bloquée par
- Phase 29

---

## Phase 32 : Historique des conversations sur 30 jours

**User stories** : US-81

### Ce qu'on livre
Le panneau liste les conversations des 30 derniers jours, avec leur date et leur première demande. Le gestionnaire en rouvre une en lecture seule et y retrouve les récapitulatifs appliqués avec leur date. Au-delà de 30 jours, une conversation n'est plus consultable.

### Critères d'acceptation
- [ ] Le panneau liste la date et la première demande de chaque conversation des 30 derniers jours
- [ ] Une ancienne conversation s'ouvre en lecture seule, avec ses récapitulatifs appliqués et leur date « Appliqué le … »
- [ ] Une conversation de plus de 30 jours n'est plus consultable, même si la tâche d'effacement n'est pas encore passée

## Bloquée par
- Phase 29
