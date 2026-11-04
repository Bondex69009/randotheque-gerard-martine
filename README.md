# La Randothèque de Gérard & Martine

Catalogue des randonnées de Gérard & Martine, construit automatiquement à partir des fichiers GPX publiés sur leurs
deux blogs : [Randonnées & Photos de Gé](https://photosge30132.blogspot.com) (plusieurs randos par article) et
[Nos chemins en itinérance](https://gr-ge-30132.blogspot.com) (étapes des GR 34, 65, 70, 700).
Chaque rando a son nom, sa distance, ses dénivelés, un temps estimé, l'IBP index, une carte, un profil et les métadonnées du fichier.

## Utilisation rapide

Il faut [Node.js](https://nodejs.org) 18 ou plus récent, et rien d'autre.

```bash
npm run update   # récupère les nouveaux GPX des deux blogs puis régénère les données
npm run serve    # ouvre la Randothèque sur http://localhost:8080
```

On peut aussi ouvrir directement `index.html` dans un navigateur.

## Mise en ligne automatique (GitHub Pages)

Le site public est hébergé gratuitement sur GitHub Pages et se met à jour tout seul toutes les heures, à hh:07.
La tâche `.github/workflows/mise-a-jour.yml` lit les deux blogs, télécharge les nouveaux GPX et résumés audio, les
enregistre dans le dépôt, régénère le site et le publie. GitHub ne garantit pas l'heure exacte de ses tâches
programmées ; un passage sauté est rattrapé l'heure suivante. La tâche ne crée un commit que s'il y a du nouveau,
et le haut du site indique l'heure de la dernière vérification. Personne n'a besoin de se connecter.

Un article modifié sur le blog est relu (nom, date, IBP, itinéraire GR…). Pour les articles de la première page du
blog, les GPX et audios sont en plus retéléchargés à chaque passage. Un fichier remplacé sur Google Drive est donc
repris sous le même nom. Si le lien GPX change, ou si l'article est remplacé par un autre (par exemple « prochaine
sortie » puis l'article définitif), l'ancien fichier est supprimé et le nouveau prend son nom.

Mise en place, une seule fois :

1. Créer un dépôt public `randotheque-gerard-martine` sur GitHub et y envoyer ce dossier.
2. Dans le dépôt : Settings > Pages > Build and deployment > Source : « GitHub Actions ».
3. Onglet Actions > Mise à jour horaire > Run workflow, pour la première publication.
4. Le site est alors disponible sur `https://bondex69009.github.io/randotheque-gerard-martine/`.

Pour forcer une mise à jour sans attendre : Actions > Mise à jour horaire > Run workflow.
En cas d'échec, GitHub envoie un e-mail au propriétaire du dépôt.

Le site n'est pas destiné aux moteurs de recherche : la page porte `<meta name="robots" content="noindex, nofollow">`
et un `robots.txt` interdit l'exploration. Sur GitHub Pages, les robots ne lisent ce fichier qu'à la racine du
domaine (`https://<compte>.github.io/robots.txt`), c'est-à-dire dans un dépôt nommé `<compte>.github.io`.

`npm run site` prépare en local le dossier `_site/` tel qu'il sera publié.
L'interface d'administration n'est pas publiée en ligne ; elle reste utilisable en local avec `npm run serve`.

## Compteur total et intégration sur le blog

Le haut du site affiche les kilomètres de Gérard & Martine depuis leur première rando publiée : la somme des randos
dont la date est passée. Pour y ajouter des kilomètres d'avant les blogs, réglez `TOTAL_REF` dans `scripts/build.mjs`.

Le bouton « Intégrer », à côté du compteur, donne un code HTML (balise `<iframe>`, fond sombre ou clair) à coller sur
Blogger, dans Mise en page > Ajouter un gadget > HTML/JavaScript. Le compteur affiché sur le blog (`compteur.html`,
qui lit le petit fichier `data/compteur.js`) se met à jour à chaque publication du site.

Les autres chiffres du haut de page (randonnées, kilomètres, dénivelé, années) suivent les filtres et la recherche,
avec une animation de compteur à chaque changement.

## Interface d'administration (en local)

Avec `npm run serve`, le terminal affiche une adresse secrète du type `http://localhost:8080/admin/XXXXXXXX`.
Elle ouvre, sans mot de passe, une page qui permet de :

- ajouter des randos en glissant des fichiers GPX (un formulaire s'ouvre pour compléter nom, date, itinéraire GR, IBP…) ;
- modifier les infos affichées de n'importe quelle rando, y compris celles du blog (le bouton « Rétablir » remet la
  valeur d'origine) ;
- supprimer une rando : celles du blog sont masquées (onglet « Masquées », bouton « Réafficher »), celles ajoutées
  à la main vont dans la corbeille (onglet « Corbeille », bouton « Restaurer ») ;
- synchroniser avec le blog pour récupérer les nouvelles sorties.

Chaque changement régénère le site en 2 à 3 secondes.

L'adresse secrète est la seule protection, donc il ne faut la donner qu'aux gestionnaires. Pour en changer,
supprimez le fichier `.admin-token` et relancez `npm run serve`, ou imposez la vôtre avec la variable `ADMIN_TOKEN`.
Les corrections sont enregistrées dans `data/overrides.json` et survivent aux synchronisations avec le blog.
L'administration a besoin du serveur `npm run serve` ; elle ne fonctionne pas sur un hébergement purement statique
(GitHub Pages, Netlify…).

## Ajouter vos propres GPX à la main

1. Déposez vos fichiers `.gpx` dans `gpx/mes-randos/` (ou n'importe quel sous-dossier de `gpx/`).
2. Lancez `npm run build`.

Les infos sont lues dans le fichier (nom, description, auteur, date, mots-clés, logiciel…). Pour compléter ou
corriger une rando, placez à côté un fichier JSON du même nom, par exemple `ma-rando.json` à côté de `ma-rando.gpx` :

```json
{ "name": "Le Mont Bouquet", "ibp": 58, "itineraires": ["GR 65"], "date": "2026-03-12", "description": "…" }
```

Les itinéraires s'écrivent en liste (`["GR 65", "GR 70"]`) ou séparés par un tiret (« GR 65 - GR 70 »).
Chacun apparaît ensuite dans le filtre « Itinéraire de grande randonnée ».

## Ce que font les scripts

| Commande | Rôle |
|---|---|
| `npm run blog` | Lit tous les articles de https://photosge30132.blogspot.com et https://gr-ge-30132.blogspot.com et repère les liens « GPX » (Google Drive, Dropbox). Un article peut contenir plusieurs randos : chacune prend le nom écrit juste avant son lien GPX, son IBP, sa photo, son album et son parking. Télécharge les fichiers dans `gpx/blog/` et les résumés audio (liens « Audio ») dans `audio/blog/`, puis note les infos de la sortie (titre, date, IBP, itinéraire GR, département, photo) dans `data/blog-catalog.json`. Seuls les articles nouveaux ou modifiés sont relus, plus ceux de la première page du blog à chaque fois. `--refresh` relit tout ; `--recent=10` relit de force les articles des 10 dernières randos et retélécharge leurs GPX et audios. |
| `npm run build` | Analyse chaque GPX de `gpx/` et génère `data/randos.js` + `data/tracks/`. |
| `npm run serve` | Petit serveur local. |

## Comment sont calculées les valeurs

- Distance : somme des distances entre les points de la trace.
- Dénivelés : altitudes lissées sur environ 60 m, puis seuil de 3 m pour ignorer le bruit GPS. Si le fichier n'a pas
  d'altitudes, elles sont demandées au service altimétrique de l'IGN.
- Temps estimé : norme DIN 33466 (4 km/h à plat, 300 m/h en montée, 500 m/h en descente), pauses non comprises.
- IBP index : valeur publiée sur le blog quand elle existe. Sinon, une estimation (affichée avec « ≈ ») par une
  régression calée sur les randos du blog qui ont un IBP officiel, avec un écart moyen d'environ 2 points.
  Pour la valeur officielle, analysez le GPX sur https://www.ibpindex.com/ibpindex/analyser.php.
- Niveau : Vert ≤ 25 (très facile), Bleu ≤ 50 (facile), Jaune ≤ 75 (moyen), Rouge ≤ 100 (difficile), Noir au-delà.
- Commune et département : déduits du point de départ via geo.api.gouv.fr.

## Dans chaque fiche de rando

Le bouton « Télécharger le GPX » propose le fichier sous son nom d'origine sur le Google Drive du blog (par exemple
`Piste_2026-11-03-Parignargues-16h08.gpx`) et indique son poids. Dans le dépôt, les fichiers gardent leur nom
(`gpx/blog/AAAA-MM-JJ_nom.gpx`), qui ne change jamais.

Le bouton « Itinéraire » ouvre Google Maps jusqu'au parking indiqué sur le blog : le lien « Vue Parking », sinon
l'arrivée de l'itinéraire « Route Google Maps », sinon les coordonnées écrites dans l'article. Ce parking n'est
retenu que s'il est à moins de 10 km du départ de la trace ; sinon, Google Maps mène au point de départ du GPX.
Les liens Google Maps courts ne sont résolus qu'une fois (`.cache/blog/maps-resolved.json`).

Chaque album Google Photos lié dans l'article (« Photos de Bruno », « Le film »…) a son bouton, qui ouvre l'album
dans un nouvel onglet. Les très anciens liens Picasa et Google+ ne fonctionnent plus et sont ignorés.

Un clic sur les chiffres ou sur le compteur du haut de page ouvre l'évolution par année : trois graphiques (nombre
de randos, kilomètres, dénivelé) et un tableau, calculés sur la sélection en cours.

Quand l'article du blog a un lien « RESUME - Audio », la fiche affiche un lecteur (lecture et pause, avance,
vitesse). Les cartes concernées portent la mention « Audio », et le filtre « Contenu > Résumé audio » les regroupe.

« Exporter la fiche en image (PNG) » produit une image de 1920 px façon « tableau de bord IBP » : indice, distances,
dénivelés, altitudes, temps total, en mouvement et de pause, vitesses, répartition montée, plat et descente.
La « fiabilité » d'IBP index n'est pas publique, alors l'image indique à sa place la source de l'indice (blog ou
estimé). Si le GPX n'a pas d'horodatage, le temps estimé remplace les temps réels.

« Analyser la trace sur ibpindex.com » envoie le GPX au formulaire d'IBP index, qui ouvre son analyse complète dans
un nouvel onglet.

Les réglages sont calés sur les analyses d'IBP index. Une pause, c'est une vitesse lissée sur 2 min inférieure à
1 km/h. La répartition montée, plat et descente se fait par tronçons de 10 m, avec l'altitude lissée sur 60 m ; le
plat va de −1,25 % à +1,25 %. Une altitude constante sur tout le parcours (0 m ou 30 m partout) est considérée comme
absente et remplacée par celle du service altimétrique de l'IGN.

## Limites connues

- Les GPX publiés avant 2017 sur l'ancien Dropbox public ne sont plus téléchargeables (liens morts) ; la liste est
  dans `.cache/blog/failed-downloads.json`.
- En 2017-2018, le blog n'affichait pas la valeur IBP : ces randos ont un IBP estimé.
- Les cartes et la police de caractères ont besoin d'une connexion internet.
