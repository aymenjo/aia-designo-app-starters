# Désigno — PRD

## Problème

Quand un véhicule d'entreprise est flashé, l'avis de contravention arrive au nom de la société. Elle a alors 45 jours pour désigner la personne qui conduisait. Si elle oublie ou dépasse le délai, elle paie l'amende initiale plus une amende pour non-désignation de 675 €.

Dans une PME qui fait rouler une quinzaine d'utilitaires, cette tâche retombe sur l'office manager ou l'assistant·e administratif·ve, entre deux autres dossiers. Les avis arrivent en ordre dispersé, par courrier ou par email. Pour chacun, il faut retrouver qui avait le véhicule ce jour-là et à cette heure-là, souvent de mémoire ou en interrogeant les équipes. Il faut ensuite reporter sans erreur l'identité et le permis du conducteur sur le site de l'ANTAI. Rien ne prévient quand l'échéance approche : un avis resté sous une pile de courrier suffit à coûter 675 €. Le résultat est un stress permanent et des pertes bien réelles, pour une tâche sans valeur ajoutée.

Même avec une flotte bien décrite, le quotidien est fait de questions et de changements qui touchent plusieurs choses à la fois. « Qui avait le camion de pool le 12 mars au matin ? », « Combien d'avis pour Karim cette année ? », « Quels avis sont encore bloqués, et pourquoi ? » : pour répondre, il faut croiser le planning, les fiches et les avis écran par écran, ou tout exporter dans un tableur. Le départ d'un salarié oblige à clôturer ses affectations, réaffecter son véhicule et archiver sa fiche, chaque geste sur un écran différent. Le gestionnaire sait exactement ce qu'il veut et pourrait le dire en une phrase, mais il doit cliquer à chaque étape. Plus la flotte et l'historique grandissent, plus ces allers-retours lui prennent de temps.

## Solution

Désigno permet au gestionnaire de flotte de ne plus jamais laisser filer une échéance de désignation, sans y passer plus de quelques minutes par avis.

- **Il décrit sa flotte une fois** : véhicules, conducteurs, et le planning de qui conduit quoi et quand. Il peut tout saisir à la main ou importer un fichier CSV.
- **Il transfère ses avis** : photo ou scan déposé dans l'application, ou relève automatique d'un libellé Gmail.
- **L'IA lit l'avis** et pré-remplit ses informations. Le gestionnaire vérifie, guidé par un niveau de confiance par champ, et Désigno calcule l'échéance des 45 jours.
- **Désigno propose le conducteur** à partir des affectations. Le gestionnaire le valide lui-même : ce n'est jamais automatique.
- **Désigno prépare un récap** prêt à reporter sur le site de l'ANTAI, avec un bouton « Copier » par champ. Le gestionnaire désigne lui-même sur l'ANTAI, marque l'avis comme désigné, et prévient le conducteur par email s'il le souhaite.
- **Rien ne s'oublie** : alertes par email à J-15, J-7 et J-2, rappel dans Google Calendar, et tableau de bord qui chiffre les euros d'amendes évités. Un rapport mensuel en PDF tient la direction informée.
- **Il demande à Désigno** (Pro) : depuis n'importe quel écran, le gestionnaire pose une question ou décrit un changement en une phrase. L'agent cherche dans la flotte, le planning et les avis, puis répond en citant les éléments sur lesquels il s'appuie. Pour un changement, il prépare toutes les modifications et les présente dans un récapitulatif : rien n'est appliqué avant que le gestionnaire clique sur « Confirmer ».
- **Le plan Free** permet d'essayer sur une petite flotte. **Le plan Pro** coûte 49 € HT par mois : une seule amende de non-désignation évitée (675 €) paie plus d'un an d'abonnement (588 € HT).

## Utilisateur cible

**Le gestionnaire** est l'office manager ou l'assistant·e administratif·ve d'une PME de 10 à 50 salariés qui exploite 5 à 30 véhicules, surtout des utilitaires : BTP, artisanat, maintenance, services sur site. Prenons l'exemple d'une entreprise de plomberie-chauffage de 30 salariés avec 15 utilitaires. Ce poste gère l'accueil, les factures fournisseurs, une partie des RH, et « les voitures ». Il n'a aucune expertise de la réglementation routière et peu de temps. Il travaille au bureau sur ordinateur, ouvre le courrier le matin et garde son téléphone à portée de main. C'est la seule personne de l'entreprise à utiliser Désigno.

**Deux acteurs secondaires n'ont pas de compte** :
- **Le conducteur** est un salarié qui utilise un véhicule attitré ou un véhicule de pool. Il reçoit un email quand il est désigné.
- **La direction** (dirigeant, gérant) reçoit le rapport mensuel de flotte en PDF.

## User Stories

**Accueil et compte**

- US-1 : En tant que visiteur, je veux voir sur la landing page la promesse, le fonctionnement en 4 étapes, les tarifs et une FAQ, afin de décider en quelques minutes si Désigno règle mon problème.
- US-2 : En tant que visiteur, je veux créer un compte en saisissant seulement mon adresse email, afin de démarrer sans mot de passe.
- US-3 : En tant que gestionnaire, je veux me connecter en cliquant sur un lien reçu par email, afin d'accéder à mon espace sans mot de passe.
- US-4 : En tant que gestionnaire, je veux, si mon lien a expiré ou a déjà servi, voir un message clair et en recevoir un nouveau en un clic, afin de ne jamais rester bloqué.
- US-5 : En tant que gestionnaire, je veux renseigner la fiche entreprise (raison sociale, représentant légal, SIREN, numéro de TVA, adresse du siège), afin que le récap ANTAI et mes factures soient au bon nom.
- US-6 : En tant que gestionnaire, je veux être alerté dès la saisie d'un SIREN ou d'un numéro de TVA mal formé, afin d'éviter une erreur sur la désignation ou sur la facture.
- US-7 : En tant que gestionnaire, je veux voir à ma première connexion une liste de démarrage (fiche entreprise, flotte, premier avis), afin de savoir par où commencer.
- US-8 : En tant que gestionnaire, je veux supprimer mon compte et toutes les données de mon entreprise, afin de partir sans laisser derrière moi les données personnelles de mes conducteurs.

**La flotte**

- US-9 : En tant que gestionnaire, je veux ajouter, modifier ou archiver un véhicule (plaque, modèle, type attitré ou pool), afin de tenir ma flotte à jour.
- US-10 : En tant que gestionnaire, je veux être bloqué si je saisis une plaque mal formée ou déjà présente, afin d'éviter les doublons et les erreurs de rapprochement.
- US-11 : En tant que gestionnaire, je veux créer la fiche d'un conducteur (identité, date de naissance, adresse, numéro et date de délivrance du permis, email facultatif), afin d'avoir sous la main tout ce que l'ANTAI demande.
- US-12 : En tant que gestionnaire, je veux voir l'indicateur « fiche complète » et la liste des champs manquants, afin de compléter les fiches avant qu'un avis n'arrive.
- US-13 : En tant que gestionnaire, je veux enregistrer une affectation (conducteur, véhicule, début, fin facultative), afin que Désigno sache qui conduit quoi et quand.
- US-14 : En tant que gestionnaire, je veux être empêché d'enregistrer une affectation qui en chevauche une autre, avec l'affectation en conflit nommée, afin de garder un planning sans ambiguïté.
- US-15 : En tant que gestionnaire, je veux consulter le planning par véhicule et le filtrer par conducteur, afin de vérifier d'un coup d'œil qui avait quel véhicule.
- US-16 : En tant que gestionnaire, je veux clôturer une affectation attitrée (départ d'un salarié, changement de véhicule), afin que les propositions de conducteur restent justes.
- US-17 : En tant que gestionnaire, je veux archiver plutôt que supprimer un véhicule ou un conducteur qui a un historique, afin de conserver la trace des avis passés.
- US-18 : En tant que gestionnaire, je veux télécharger les modèles CSV véhicules et conducteurs, afin de préparer mon import sans deviner le format.
- US-19 : En tant que gestionnaire, je veux voir avant l'import les lignes valides et les lignes en erreur avec leur motif, afin de corriger mon fichier en connaissance de cause.
- US-20 : En tant que gestionnaire, je veux que seules les lignes valides soient importées et que les doublons soient ignorés, afin de ne pas tout recommencer pour une ligne fautive.
- US-21 : En tant que gestionnaire, je veux indiquer le conducteur attitré dans le fichier véhicules, afin que les affectations soient créées dès l'import.
- US-22 : En tant que gestionnaire, je veux voir un état vide qui m'invite à ajouter mon premier véhicule ou à importer un fichier, afin de démarrer rapidement.

**Les avis de contravention**

- US-23 : En tant que gestionnaire, je veux déposer un scan ou une photo d'avis depuis mon ordinateur, afin d'enregistrer un avis reçu par courrier ou par email.
- US-24 : En tant que gestionnaire, je veux photographier un avis papier depuis mon téléphone, l'appareil photo s'ouvrant directement, afin de l'enregistrer dès l'ouverture du courrier.
- US-25 : En tant que gestionnaire Pro, je veux connecter ma boîte Gmail et choisir un libellé, afin que les avis que j'y range soient relevés automatiquement.
- US-26 : En tant que gestionnaire Pro, je veux voir dans « Emails non exploitables » les emails du libellé sans pièce jointe exploitable, afin de ne laisser passer aucun avis.
- US-27 : En tant que gestionnaire Pro, je veux être prévenu par un bandeau et par email si la relève Gmail est interrompue, afin de ne pas croire à tort que tout est relevé.
- US-28 : En tant que gestionnaire, je veux que l'IA lise le n° d'avis, la plaque, la date et l'heure, le lieu, l'infraction, le montant et la date d'envoi, afin de ne rien recopier à la main.
- US-29 : En tant que gestionnaire, je veux vérifier les champs à côté de l'image de l'avis, avec un niveau de confiance par champ, afin de concentrer mon attention sur les champs douteux.
- US-30 : En tant que gestionnaire, je veux saisir ou corriger à la main un champ mal lu, ou tout un avis illisible, afin de ne jamais être bloqué par une mauvaise lecture.
- US-31 : En tant que gestionnaire, je veux voir l'échéance des 45 jours calculée automatiquement, et recalculée si je corrige la date d'envoi, afin de connaître ma vraie date limite.
- US-32 : En tant que gestionnaire, je veux être averti, avec un lien vers l'avis existant, quand je dépose un avis déjà enregistré, afin de ne pas traiter deux fois le même avis.
- US-33 : En tant que gestionnaire, je veux voir le conducteur proposé d'après les affectations, afin de ne plus chercher qui conduisait.
- US-34 : En tant que gestionnaire, je veux, quand aucune affectation ne couvre l'infraction, voir comme indices le conducteur d'avant et celui d'après, puis choisir moi-même, afin d'avancer malgré un planning incomplet.
- US-35 : En tant que gestionnaire, je veux enregistrer en un clic l'affectation manquante au moment de valider, afin de compléter mon planning au fil des avis.
- US-36 : En tant que gestionnaire, je veux, quand la plaque ne correspond à aucun véhicule, créer le véhicule depuis l'avis ou classer l'avis, afin de traiter les plaques inconnues sans quitter l'écran.
- US-37 : En tant que gestionnaire, je veux voir mes avis triés par échéance la plus proche et filtrables par statut, afin de traiter l'urgent d'abord.
- US-38 : En tant que gestionnaire, je veux voir un badge « Échéance dépassée » sur les avis en retard, afin de repérer immédiatement les cas critiques.
- US-39 : En tant que gestionnaire, je veux classer un avis avec un motif, afin de sortir du suivi les avis qui ne donnent pas lieu à désignation, sans fausses alertes.
- US-40 : En tant que gestionnaire, je veux rouvrir un avis désigné ou classé par erreur, afin de corriger mon suivi.

**La désignation**

- US-41 : En tant que gestionnaire, je veux valider moi-même le conducteur proposé ou en choisir un autre, afin de rester seul responsable de la désignation.
- US-42 : En tant que gestionnaire, je veux, si la fiche conducteur ou la fiche entreprise est incomplète, voir les champs manquants et les compléter sans quitter l'avis, afin d'obtenir mon récap sans détour.
- US-43 : En tant que gestionnaire, je veux un récap prêt à reporter sur le site de l'ANTAI, avec un bouton « Copier » par champ, afin de désigner en quelques copier-coller, sans faute de frappe.
- US-44 : En tant que gestionnaire, je veux ouvrir le site de l'ANTAI depuis le récap, afin d'enchaîner sans chercher l'adresse.
- US-45 : En tant que gestionnaire, je veux marquer l'avis « Désigné » une fois la désignation faite sur l'ANTAI, afin que le suivi et les alertes reflètent la réalité.
- US-46 : En tant que gestionnaire Pro, je veux prévenir le conducteur par email, après un aperçu, au moment où je marque l'avis comme désigné, afin qu'il ne soit pas surpris par l'avis à son nom.
- US-47 : En tant que conducteur, je veux recevoir un email qui résume les faits et m'annonce l'avis à mon nom, afin de savoir à quoi m'attendre et de pouvoir répondre au gestionnaire.

**Les alertes et le suivi**

- US-48 : En tant que gestionnaire, je veux recevoir une alerte par email à J-15, J-7 et J-2 pour chaque avis ni désigné ni classé, afin de ne jamais laisser filer une échéance.
- US-49 : En tant que gestionnaire, je veux ne plus recevoir d'alerte pour un avis désigné ou classé, afin de ne pas être dérangé pour rien.
- US-50 : En tant que gestionnaire Pro, je veux un rappel à J-2 dans un agenda Google Calendar « Désigno », afin de retrouver mes échéances là où je planifie ma semaine.
- US-51 : En tant que gestionnaire, je veux voir sur le tableau de bord les avis à traiter, les échéances proches, les avis désignés et les euros d'amendes évités, afin de savoir en un coup d'œil où j'en suis et ce que Désigno m'a fait économiser.
- US-52 : En tant que gestionnaire, je veux consulter le tableau de bord depuis mon téléphone, afin de vérifier l'urgent hors du bureau.
- US-53 : En tant que gestionnaire Pro, je veux exporter l'historique de mes avis en CSV, afin de le transmettre à la comptabilité ou de l'archiver.
- US-54 : En tant que gestionnaire Pro, je veux renseigner jusqu'à 3 adresses « direction », afin que la direction suive la flotte sans avoir de compte.
- US-55 : En tant que direction, je veux recevoir le 1er de chaque mois le rapport de flotte en PDF du mois écoulé, afin de suivre les amendes et les économies sans me connecter.
- US-56 : En tant que gestionnaire Pro, je veux télécharger les rapports des mois passés, afin de retrouver un bilan à tout moment.

**L'abonnement**

- US-57 : En tant que gestionnaire Free, je veux voir mon usage (« 2/3 véhicules », « 4/5 avis ce mois-ci »), afin d'anticiper le passage en Pro.
- US-58 : En tant que gestionnaire Free, je veux être invité à passer en Pro quand l'ajout d'un 4e véhicule est refusé, afin de comprendre pourquoi.
- US-59 : En tant que gestionnaire Free, je veux que mon 6e avis du mois soit quand même enregistré, avec son échéance et ses alertes, afin de ne jamais rater une échéance à cause du quota.
- US-60 : En tant que gestionnaire Free, je veux voir les fonctions Pro avec un cadenas et une explication, afin de savoir ce que j'obtiendrai en passant en Pro.
- US-61 : En tant que gestionnaire, je veux passer en Pro par paiement par carte et recevoir une facture à la raison sociale, afin de passer la dépense en charge et de récupérer la TVA.
- US-62 : En tant que gestionnaire Pro, je veux accéder à un portail client pour gérer ma carte, mes factures et l'annulation, afin de tout gérer sans contacter personne.
- US-63 : En tant que gestionnaire Pro, je veux être prévenu d'un échec de paiement et avoir le temps de mettre à jour ma carte, afin de ne pas perdre le Pro par surprise.
- US-64 : En tant que gestionnaire repassé en Free, je veux choisir mes 3 véhicules actifs sans qu'aucune donnée ne soit supprimée, afin de continuer sans rien perdre.
- US-65 : En tant que gestionnaire Free, je veux retrouver tout mon historique en repassant en Pro, afin de ne rien avoir perdu entre-temps.

**Demande à Désigno**

- US-66 : En tant que gestionnaire Pro, je veux ouvrir « Demande à Désigno » depuis n'importe quel écran, dans un panneau latéral, afin de poser ma question sans quitter ce que je fais.
- US-67 : En tant que gestionnaire Pro, je veux voir des exemples de demandes à l'ouverture d'une nouvelle conversation, afin de découvrir ce que l'agent sait faire.
- US-68 : En tant que gestionnaire Pro, je veux poser en langage courant une question sur ma flotte, mon planning ou mes avis, afin d'obtenir la réponse sans croiser les écrans ni exporter.
- US-69 : En tant que gestionnaire Pro, je veux que chaque réponse cite les avis, véhicules, conducteurs ou affectations sur lesquels elle s'appuie, avec un lien vers chacun, afin de vérifier d'un clic.
- US-70 : En tant que gestionnaire Pro, je veux que l'agent comprenne « cet avis », « ce véhicule » ou « ce conducteur » d'après l'écran ouvert, afin de ne pas tout répéter.
- US-71 : En tant que gestionnaire Pro, je veux voir l'étape en cours pendant que l'agent cherche, et pouvoir l'arrêter, afin de savoir qu'il avance et de garder la main.
- US-72 : En tant que gestionnaire Pro, je veux décrire en une phrase un changement qui touche plusieurs véhicules, conducteurs ou affectations, afin de ne pas le faire écran par écran.
- US-73 : En tant que gestionnaire Pro, je veux voir toutes les modifications prévues dans un récapitulatif numéroté et les appliquer d'un seul clic sur « Confirmer », afin que rien ne change sans mon accord.
- US-74 : En tant que gestionnaire Pro, je veux demander une correction du récapitulatif ou l'annuler, afin d'ajuster sans tout recommencer.
- US-75 : En tant que gestionnaire Pro, je veux que l'agent me pose une question quand ma demande est ambiguë, par exemple deux Karim ou une date manquante, afin qu'il n'agisse pas sur une supposition.
- US-76 : En tant que gestionnaire Pro, je veux que le récapitulatif signale chaque modification impossible (chevauchement, plaque mal formée ou déjà présente) avec le même motif que dans les écrans, afin de corriger avant de confirmer.
- US-77 : En tant que gestionnaire Pro, je veux que les modifications d'un récapitulatif soient appliquées toutes ou aucune, avec un message si l'application échoue, afin de ne jamais laisser ma flotte à moitié modifiée.
- US-78 : En tant que gestionnaire Pro, je veux que l'agent refuse ce qui sort de son rôle (désigner, classer, écrire à un salarié, supprimer, question sans rapport) et m'indique où le faire, afin de savoir comment avancer.
- US-79 : En tant que gestionnaire Pro, je veux voir mon usage (« 12/100 demandes ce mois-ci »), afin d'anticiper la limite.
- US-80 : En tant que gestionnaire Pro, je veux, une fois les 100 demandes atteintes, voir la date de remise à zéro, afin de continuer par les écrans en attendant.
- US-81 : En tant que gestionnaire Pro, je veux retrouver mes conversations des 30 derniers jours, avec les récapitulatifs appliqués et leur date, afin de savoir ce que l'agent a modifié.
- US-82 : En tant que gestionnaire Pro, je veux démarrer une nouvelle conversation, afin de repartir sur un autre sujet.
- US-83 : En tant que gestionnaire Free, je veux voir « Demande à Désigno » avec un cadenas et une explication, afin de savoir ce que j'obtiendrai en passant en Pro.

## Critères de succès

**Seuils mesurés**

- Un avis lisible, sur un véhicule qui a une affectation à la date de l'infraction, passe du dépôt au récap ANTAI prêt à copier en moins de 3 minutes.
- Sur un jeu de 20 avis réels anonymisés, au moins 90 % des champs lus (n° d'avis, plaque, date et heure, lieu, infraction, montant, date d'envoi) sont correctement pré-remplis.
- Un email avec un avis en pièce jointe, placé dans le libellé Gmail, apparaît comme avis « À traiter » en moins de 20 minutes.

**Avis et désignation**

- Sur 100 % des avis du jeu de test, l'échéance affichée est égale à la date d'envoi plus 45 jours, et elle change immédiatement quand la date d'envoi est corrigée.
- Déposer deux fois un avis avec le même n° d'avis ne crée jamais un second avis, et le message affiché renvoie vers l'avis existant.
- Quand une affectation couvre la date et l'heure de l'infraction, le conducteur proposé est celui de cette affectation, dans 100 % des cas.
- Aucun avis ne passe en « Désigné » sans un clic du gestionnaire sur « J'ai désigné sur l'ANTAI ».
- Chaque champ du récap se copie en un clic, avec une confirmation visuelle « Copié ».
- Un conducteur avec un email reçoit le message de désignation quand l'avis est marqué « Désigné » et que la case « Prévenir le conducteur » est cochée (Pro).

**Flotte**

- Une affectation qui en chevauche une autre est refusée dans 100 % des cas, et le message nomme le conducteur, le véhicule et le créneau en conflit.
- Un fichier de 15 véhicules et 15 conducteurs conforme au modèle s'importe en une seule opération. Toute ligne invalide est listée avec son motif et n'est pas importée.

**Alertes et rapport**

- Pour un avis ni désigné ni classé, le gestionnaire reçoit un email à J-15, J-7 et J-2. Il n'en reçoit plus aucun une fois l'avis désigné ou classé.
- En Pro, un événement apparaît dans l'agenda « Désigno » à J-2 pour chaque avis ouvert, et disparaît quand l'avis passe en « Désigné » ou « Classé ».
- Le tableau de bord ajoute 675 € aux euros d'amendes évités pour chaque avis marqué « Désigné » au plus tard le jour de son échéance, et 0 € pour tout autre avis.
- En Pro, le 1er de chaque mois, les adresses « direction » et le gestionnaire reçoivent le rapport PDF du mois écoulé.

**Abonnement**

- En Free, l'ajout d'un 4e véhicule est refusé. Le 6e avis du mois est enregistré, marqué « Verrouillé », et déclenche bien ses alertes J-15, J-7 et J-2.
- Après paiement, le compte passe en Pro immédiatement, et une facture au nom de la raison sociale, avec SIREN et numéro de TVA, arrive par email.
- Depuis le portail client, le gestionnaire change sa carte, télécharge une facture et annule son abonnement, sans intervention humaine.
- En Free, « Demande à Désigno » s'affiche avec un cadenas et ne traite aucune demande.

**Demande à Désigno**

- Sur un jeu de 30 questions réelles posées sur un compte de démonstration (15 véhicules, 15 conducteurs, 6 mois de planning et d'avis), au moins 90 % des réponses sont exactes.
- 90 % des questions de ce jeu reçoivent leur réponse complète en moins de 30 secondes.
- Chaque réponse fondée sur des données cite au moins un élément, avec un lien qui ouvre la bonne fiche.
- Aucune modification n'est appliquée sans un clic sur « Confirmer ».
- « Karim part vendredi, passe son camion à Léa » produit un récapitulatif avec une clôture, une nouvelle affectation et un archivage, appliqué en un seul clic.
- Tant qu'une ligne du récapitulatif est impossible, « Confirmer » est désactivé.
- Après « Confirmer », soit toutes les modifications sont visibles dans les écrans, soit aucune.
- Sur un jeu de 10 demandes hors rôle (désigner, classer, écrire à un salarié, supprimer…), 100 % sont refusées avec un lien vers l'écran concerné, et aucune donnée n'est modifiée.
- En Pro, la 101ᵉ demande du mois est refusée avec la date de remise à zéro, et le compteur repart à 0 le 1er du mois.
- Une conversation de plus de 30 jours n'est plus consultable.

**Compte et mobile**

- Un lien de connexion expiré ou déjà utilisé affiche un message et un bouton qui envoie un nouveau lien.
- Sur téléphone, un avis se photographie et se dépose depuis l'écran de dépôt sans défilement horizontal.

## Hors périmètre

- Désigner automatiquement, ou transmettre quoi que ce soit directement à l'ANTAI : le gestionnaire désigne toujours lui-même sur le site.
- Payer ou contester une amende depuis Désigno.
- Un traitement dédié des avis de stationnement non soumis à désignation et des avis étrangers : on peut seulement les classer.
- Plusieurs gestionnaires, rôles ou invitations. Plusieurs entreprises (SIREN) dans un même compte.
- Un espace ou un compte conducteur.
- Une application mobile à installer.
- Les messageries autres que Gmail et les agendas autres que Google Calendar.
- Le suivi du solde de points, la vérification de la validité des permis, et les retenues ou refacturations d'amendes aux salariés.
- La gestion de flotte au sens large : entretien, carburant, géolocalisation, contrats de location.
- Le plan annuel, l'essai gratuit du Pro et les codes promo.
- Toute autre langue que le français, tout autre pays que la France.
- La réservation des véhicules de pool par les conducteurs depuis leur téléphone.
- Les agents qui travaillent seuls en arrière-plan : l'agent enquêteur qui interroge les conducteurs, la collecte des fiches auprès des conducteurs, la récupération des avis reçus sous forme de lien.
- Pour « Demande à Désigno » :
  - Valider un conducteur, marquer un avis « Désigné », classer, rouvrir ou corriger un avis.
  - Supprimer quoi que ce soit : l'agent archive seulement.
  - Modifier la fiche entreprise, les paramètres ou l'abonnement.
  - Écrire à un conducteur ou à la direction, ou envoyer quoi que ce soit hors de Désigno.
  - Importer des fichiers (planning, liste du personnel, photos) par la conversation.
  - Chercher hors de Désigno (boîte Gmail, agenda, web) ou répondre à des questions de réglementation.
  - Agir ou suggérer sans être sollicité.
  - L'usage sur téléphone et la voix.

## Décisions d'implémentation

**Compte et entreprise**

- Une entreprise correspond à un seul gestionnaire et à une seule adresse email.
- Le lien de connexion est valable 15 minutes et ne sert qu'une fois. La session reste ouverte 30 jours sur un même appareil.
- La fiche entreprise contient : raison sociale, représentant légal (nom, prénom, fonction), SIREN (9 chiffres, contrôlé), numéro de TVA intracommunautaire (contrôlé), adresse du siège, et, en Pro, jusqu'à 3 adresses « direction ».
- Tant que la fiche entreprise, la flotte et le premier avis ne sont pas renseignés, le tableau de bord affiche une liste de démarrage en 3 étapes, cochées au fur et à mesure.
- Supprimer son compte demande une confirmation par saisie de la raison sociale. La suppression efface toutes les données et annule l'abonnement.

**Flotte**

- Les plaques sont acceptées au format actuel (AB-123-CD) ou à l'ancien format (123 ABC 45). Elles sont affichées en majuscules avec tirets.
- Pour un véhicule attitré, une nouvelle affectation a une fin vide par défaut. Pour un véhicule de pool, l'heure de fin est obligatoire.
- La fiche conducteur contient : civilité, nom, prénom, date de naissance, adresse postale, numéro de permis, date de délivrance du permis, et un email facultatif. Le badge « Fiche complète » apparaît quand tous les champs sauf l'email sont remplis. Sinon, le badge orange « Incomplète » est suivi du nombre de champs manquants.
- Le planning se présente en vue chronologique par véhicule (semaine ou mois), avec un filtre par conducteur.
- Un chevauchement bloque l'enregistrement, avec un message du type « Conflit avec : Karim B. sur AB-123-CD du 03/03 08:00 au 03/03 18:00 ».
- Un véhicule ou un conducteur qui a des affectations ou des avis ne peut pas être supprimé, seulement archivé. Il disparaît alors des listes et des propositions, mais reste visible dans l'historique.
- L'import CSV se fait avec deux modèles téléchargeables. Le fichier véhicules a deux colonnes facultatives : « conducteur attitré » (email ou n° de permis) et « attitré depuis le » (date d'import par défaut). Un aperçu précède l'import. Les plaques et permis déjà présents sont ignorés et les lignes valides sont importées. En Free, les véhicules au-delà du 3e sont listés comme non importés, avec une invitation à passer en Pro.

**Avis**

- Formats acceptés : PDF, JPG, PNG et HEIC, jusqu'à 10 Mo. Un fichier correspond à un avis.
- La confiance s'affiche sur 3 niveaux : vert (sûr), orange (à vérifier), rouge (non lu ou douteux). L'image de l'avis, zoomable, est affichée à côté des champs. L'avis passe en « À valider » quand tous les champs sont remplis et que les champs rouges ont été confirmés.
- L'échéance est égale à la date d'envoi plus 45 jours. Elle s'affiche sous la forme « avant le 18/11/2026 · J-12 ».
- Un avis dont le n° existe déjà dans l'entreprise est refusé, avec le message « Cet avis existe déjà » et un lien. Lors de la relève Gmail, un doublon est ignoré sans créer d'avis.
- Les statuts :
  - « À traiter » : avis reçu, champs à vérifier.
  - « À valider » : champs vérifiés, conducteur proposé ou à choisir, en attente de validation et de report sur l'ANTAI.
  - « Désigné » : le gestionnaire a cliqué « J'ai désigné sur l'ANTAI », et la date de ce clic est enregistrée.
- « Classé » est possible depuis n'importe quel statut, avec un motif obligatoire : avis contesté, véhicule volé ou plaque usurpée, avis non soumis à désignation, ou autre (texte libre).
- Un avis désigné ou classé peut être rouvert : il repasse en « À valider » et les euros évités sont recalculés.
- Badges : « Échéance dépassée » (rouge, sans changer le statut), « Véhicule inconnu », « Verrouillé » (Free).
- La liste des avis est triée par échéance la plus proche, avec un filtre par statut.
- Proposition du conducteur :
  - Si une affectation couvre la date et l'heure de l'infraction, son conducteur est proposé.
  - Sinon, le message « Aucune affectation à cette date » s'affiche, avec comme indices le dernier conducteur avant et le premier après sur ce véhicule. Le gestionnaire choisit lui-même, puis on lui propose d'enregistrer l'affectation manquante.
  - Si la plaque est inconnue, le gestionnaire crée le véhicule (plaque pré-remplie) ou classe l'avis.

**Relève Gmail (Pro)**

- Le gestionnaire connecte sa boîte depuis les paramètres et choisit un libellé existant. La relève a lieu toutes les 15 minutes environ.
- Seules les pièces jointes PDF ou image sont traitées, une pièce jointe donnant un avis. L'email d'origine reste consultable depuis l'avis.
- Les emails sans pièce jointe exploitable vont dans « Emails non exploitables », avec deux actions : « Déposer manuellement » et « Ignorer ».
- Désigno ne lit que le libellé choisi et n'envoie jamais rien depuis la boîte. Si la connexion est interrompue, un bandeau rouge reste affiché jusqu'à la reconnexion et un email part au gestionnaire.

**Désignation**

- La validation du conducteur passe toujours par le bouton « Valider ce conducteur », même quand une seule personne est proposée.
- Le récap n'est accessible que si les fiches conducteur et entreprise sont complètes. Sinon, les champs manquants s'affichent et se complètent sur place.
- Le récap comporte 3 blocs :
  - Avis : n°, date et heure, plaque.
  - Entreprise : raison sociale, SIREN, représentant légal.
  - Conducteur : civilité, nom, prénom, date de naissance, adresse, n° de permis, date de délivrance.

  Chaque champ a un bouton « Copier » avec un retour « Copié ». Les dates sont au format JJ/MM/AAAA. Un lien ouvre le site de l'ANTAI dans un nouvel onglet.
- L'email au conducteur (Pro) part au clic sur « J'ai désigné sur l'ANTAI », après un aperçu. La case « Prévenir le conducteur » est cochée par défaut. Elle est désactivée, avec la mention « email manquant », si le conducteur n'a pas d'email. L'email reprend les faits (date, heure, lieu, véhicule, infraction, montant) et annonce un nouvel avis au nom du conducteur. Les réponses arrivent chez le gestionnaire. Le scan n'est pas joint.

**Demande à Désigno (Pro)**

- **Accès.** Un bouton « Demande à Désigno » est présent sur tous les écrans de l'application. Il ouvre un panneau latéral sans quitter l'écran. Ordinateur seulement.
- **État vide.** Une nouvelle conversation affiche 3 exemples cliquables : « Qui avait AB-123-CD le 12/03 à 8 h ? », « Quels avis sont bloqués, et pourquoi ? », « Karim part vendredi, passe son camion à Léa ».
- **Contexte.** Ouvert depuis un avis, un véhicule ou un conducteur, le panneau le rappelle en haut (« Sur : avis n° … »). « Cet avis », « ce véhicule » et « ce conducteur » le désignent.
- **Ce que l'agent consulte.** Les véhicules, conducteurs, affectations et avis de l'entreprise, archivés compris. Rien d'autre.
- **Réponses.**
  - En français, courtes, avec une liste ou un tableau dès qu'il y a plusieurs éléments.
  - Chaque élément cité est un lien vers sa fiche. Formats : JJ/MM/AAAA, 24 h, « 135,00 € ».
  - Sans donnée pour répondre, l'agent le dit (« Aucune affectation sur AB-123-CD le 12/03 ») au lieu de supposer.
- **Pendant la recherche.** Le panneau affiche l'étape en cours, par exemple « Je consulte le planning de AB-123-CD… ». Un bouton « Arrêter » interrompt la demande.
- **Modifications.**
  - **Ce qui est permis.** Créer, modifier et archiver des véhicules et des conducteurs. Créer, modifier et clôturer des affectations.
  - **Le récapitulatif.** Il est numéroté, avec une ligne par modification, et l'avant/après pour une modification. Il porte trois boutons : « Confirmer », « Modifier » (le gestionnaire précise en une phrase et l'agent refait le récapitulatif) et « Annuler ».
  - **Les règles des écrans s'appliquent.** Format de plaque, doublons, chevauchement, fin obligatoire sur un véhicule de pool, limites Free. Une ligne impossible s'affiche en rouge avec le motif des écrans, et « Confirmer » reste désactivé tant qu'elle n'est pas corrigée ou retirée.
  - **Tout ou rien.** Si une modification n'est plus possible au moment de confirmer, parce qu'une donnée a changé entre-temps, rien n'est appliqué et un message l'explique.
  - **Après application.** Le récapitulatif affiche « Appliqué le JJ/MM/AAAA à HH:MM » et les écrans reflètent aussitôt les changements.
  - **Expiration.** Un récapitulatif non confirmé n'est plus applicable dès qu'une nouvelle conversation démarre.
- **Ambiguïté.** Si la demande peut viser plusieurs éléments, ou s'il manque une information indispensable, l'agent pose une question avant de proposer un récapitulatif.
- **Refus.** Une demande hors rôle reçoit une phrase d'explication et un lien vers l'écran concerné, par exemple « Je ne peux pas désigner. Ouvrez l'avis n° … pour valider le conducteur. ». Une question sans rapport reçoit « Je réponds seulement sur votre flotte, votre planning et vos avis. ».
- **Limite.** 100 demandes par mois calendaire.
  - Chaque message envoyé compte pour une demande. Les clics sur « Confirmer » et « Annuler » ne comptent pas.
  - Le compteur « 12/100 demandes ce mois-ci » est affiché dans le panneau.
  - À 100, la saisie est désactivée avec le message « Limite atteinte, retour le 01/11 ».
- **Historique.** Une conversation en cours, et un bouton « Nouvelle conversation ». La liste des conversations des 30 derniers jours (date et première demande) se consulte en lecture. Au-delà de 30 jours, elles sont effacées.
- **Free.** Le bouton est visible avec un cadenas. Le panneau explique la fonction et invite à passer en Pro.

**Alertes et suivi**

- Un seul email d'alerte par jour, qui regroupe tous les avis atteignant ce jour-là J-15, J-7 ou J-2, avis verrouillés compris. Un seuil déjà passé quand l'avis arrive n'est pas rattrapé : c'est le seuil suivant qui s'applique.
- Google Calendar (Pro) : un agenda dédié « Désigno », avec un événement « sur la journée » à J-2, intitulé « Désigner – AB-123-CD – avant le 18/11 » et contenant le lien vers l'avis. L'événement est mis à jour si l'échéance change et supprimé quand l'avis passe en « Désigné » ou « Classé ».
- Le tableau de bord affiche 4 tuiles :
  - Avis à traiter (« À traiter » et « À valider »).
  - Échéances proches (15 jours ou moins).
  - Avis désignés.
  - Euros d'amendes évités : libellé « amendes de non-désignation évitées », 675 € par avis désigné au plus tard le jour de son échéance, sur le mois en cours et en cumul.

  Sous les tuiles, la liste des 5 prochaines échéances. Le tableau de bord est utilisable sur téléphone.
- L'export CSV (Pro) contient tous les avis, avec leur statut, le conducteur désigné et les dates clés.
- Le rapport mensuel PDF (Pro) part le 1er du mois aux adresses « direction », avec le gestionnaire en copie. Il fait une ou deux pages et contient : avis reçus, désignés, classés, échéances dépassées, euros évités (sur le mois et en cumul), véhicules et conducteurs les plus verbalisés, fiches incomplètes. Un mois sans avis donne quand même un rapport, avec la mention « Aucun avis ce mois-ci ». Les rapports passés restent téléchargeables.

**Abonnement**

- Free (0 €) : 3 véhicules actifs, 5 avis par mois calendaire (comptés au dépôt), historique visible sur 3 mois. Les avis plus anciens sont masqués mais jamais supprimés. Un compteur d'usage est toujours visible.
- Pro (49 € HT par mois, soit 58,80 € TTC) : véhicules et avis illimités, relève Gmail, email au conducteur, Demande à Désigno (100 demandes par mois), rappels Google Calendar, historique complet, export CSV et rapport mensuel.
- En Free, les fonctions Pro sont visibles avec un cadenas et une phrase d'explication.
- Le 6e avis du mois en Free :
  - Il est enregistré avec le badge « Verrouillé ». Le gestionnaire saisit lui-même la plaque et la date d'envoi, ce qui permet de calculer l'échéance et d'activer les alertes.
  - La lecture par l'IA, la proposition de conducteur et le récap restent verrouillés jusqu'au 1er du mois suivant, où l'avis compte dans le quota de ce mois, ou jusqu'au passage en Pro.
- Pour passer en Pro, la fiche entreprise doit être complète. Le paiement par carte se fait sur une page sécurisée, et l'accès Pro est immédiat. Une facture mensuelle à la raison sociale, avec SIREN et TVA, est envoyée par email.
- Le portail client permet de changer de carte, de télécharger les factures et d'annuler. L'annulation prend effet à la fin de la période payée.
- En cas d'échec de paiement, le gestionnaire reçoit un email et voit un bandeau. Sans régularisation sous 7 jours, le compte repasse en Free.
- Retour en Free :
  - Aucune donnée n'est supprimée. À la connexion suivante, le gestionnaire choisit ses 3 véhicules actifs, et les autres passent en lecture seule. Leurs nouveaux avis sont acceptés mais verrouillés.
  - La relève Gmail, les emails aux conducteurs, Demande à Désigno, les nouveaux rappels d'agenda, l'export et le rapport s'arrêtent. Un récapitulatif non confirmé n'est plus applicable.

**Format et support**

- Tout est en français. Dates au format JJ/MM/AAAA, heures sur 24 h, montants au format « 135,00 € ».
- L'application web est conçue pour l'ordinateur. Sur téléphone, deux écrans sont soignés : le dépôt d'un avis (appareil photo ouvert directement) et le tableau de bord.
- La landing page comporte la promesse, les 4 étapes (1. Transférez vos avis, 2. L'IA les lit, 3. Désigno retrouve le conducteur, 4. Vous désignez sur l'ANTAI, sans oubli), les tarifs Free et Pro avec l'argument « une seule amende évitée paie plus d'un an d'abonnement », et une FAQ. La FAQ répond notamment à : « Désigno désigne-t-il à ma place ? », « Mes données sont-elles protégées ? », « Que se passe-t-il si je dépasse le plan Free ? », « L'agent peut-il modifier mes données sans mon accord ? ».

## Notes complémentaires

- **Risque prioritaire** : la liste exacte des champs demandés par le formulaire de désignation de l'ANTAI (lieu de naissance ? catégorie de permis ?) est à vérifier avant de développer. C'est elle qui définit l'indicateur « fiche complète » et le contenu du récap.
- **Risque prioritaire** : beaucoup d'avis électroniques de l'ANTAI arrivent sous forme de lien, sans pièce jointe. Ces emails tomberont dans « Emails non exploitables » et devront être déposés à la main.
- **Risque** : les photos floues ou mal cadrées. Le niveau de confiance par champ et la saisie manuelle servent de garde-fous.
- **Risque** : une réponse fausse donnée avec aplomb par l'agent, par exemple un mauvais conducteur sur un créneau. Les liens vers les éléments cités permettent de vérifier, et l'agent ne valide jamais de conducteur.
- **Hypothèses** :
  - L'échéance est égale à la date d'envoi plus 45 jours, et 675 € est le montant forfaitaire de l'amende de non-désignation. L'échéance affichée est indicative : Désigno ne fait pas de conseil juridique.
  - Quand le représentant légal conduisait lui-même, il doit être désigné comme n'importe quel conducteur. Ce n'est donc pas un motif de classement.
- **Données personnelles** : la date de naissance, l'adresse et le permis des conducteurs sont des données sensibles. Il faut informer les conducteurs et définir une durée de conservation. Les conversations avec l'agent contiennent aussi ces données : elles sont effacées au bout de 30 jours, et l'information des conducteurs doit les mentionner.
- **Dépendances externes** : Gmail, Google Calendar, le prestataire de paiement, le service de lecture par IA, le service d'agent IA (dont le coût par demande est à suivre en bêta pour valider la limite de 100 demandes par mois), et le site de l'ANTAI (hors de notre contrôle).
- **Contexte** : Désigno est le projet fil rouge d'une série.
