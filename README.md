# Lotto Patterns - Analyse du Lotto Ivoirien 🎰

Outil d'analyse des patterns dans les résultats du Lotto Ivoirien (Lotobonheur.ci).

## 🚀 Installation

```bash
npm install
```

## 📋 Configuration

1. Créez un projet Supabase (https://supabase.com)
2. Configurez `.env.local`:
   ```
   SUPABASE_URL=votre_url_supabase
   SUPABASE_KEY=votre_anon_key
   ```

## 📚 Utilisation

### Étape 1: Créer la base de données

```bash
npm run setup-db
```

Cela affichera le SQL à exécuter dans votre éditeur SQL Supabase.

### Étape 2: Récupérer les résultats

```bash
npm run scrape
```

Récupère tous les résultats depuis octobre 2020 (65 mois de données).

### Étape 3: Analyser les patterns

```bash
npm run analyze
```

## 📊 Types de Patterns Analysés

| Pattern | Description |
|---------|-------------|
| 🔥 Hot Numbers | Numéros les plus fréquents |
| ❄️ Cold Numbers | Numéros les moins fréquents |
| ⏰ Overdue Numbers | Numéros "en retard" |
| 🔢 Consecutive | Patterns de numéros consécutifs |
| 🎯 Odd/Even | Distribution pairs/impairs |
| ➕ Sum Ranges | Analyse des sommes |
| 👥 Pairs | Paires de numéros fréquentes |
| 📅 Day of Week | Favoris par jour |

## 📁 Structure des Tables

### `draw_types`
Types de tirages (Reveil, Etoile, National, etc.)

### `draws`
Résultats des tirages avec:
- 5 numéros gagnants
- 5 numéros machine
- Date, jour de la semaine

### `number_frequency`
Fréquence de chaque numéro par type de tirage

### `patterns`
Patterns identifiés avec score de confiance

## 📈 Données Disponibles

- **36 types de tirages**
- **65 mois de données** (oct 2020 - fév 2026)
- **Milliers de résultats**

## ⚠️ Avertissement

Cet outil est à but éducatif uniquement. Les résultats de loterie sont aléatoires et les patterns passés ne garantissent pas les résultats futurs.

## 📄 Licence

ISC

## 🚨 Guide de Démarrage Rapide (Serveur)

Si vous devez redémarrer le serveur ou en cas de coupure :

**1. Lancer le Serveur**
Ouvrez un terminal dans le dossier du projet et lancez :
```bash
npm start
```
*Le serveur démarrera sur le port 3000.*

**2. Accéder au Dashboard**
Ouvrez votre navigateur :
- **Accueil** : [http://localhost:3000](http://localhost:3000)
- **Cerveau IA** : [http://localhost:3000/brain.html](http://localhost:3000/brain.html)

**3. Problèmes Courants**
* **Erreur "EADDRINUSE" (Port occupé)** :
  Cela signifie que le serveur tourne déjà en arrière-plan. Pour le tuer et relancer :
  ```bash
  # Tuer le processus sur le port 3000
  kill -9 $(lsof -t -i:3000)
  
  # Relancer
  npm start
  ```

* **Mise à jour des Tirages** :
  Le serveur fait une mise à jour automatique. Si besoin de forcer :
  ```bash
  npm run scrape
  ```

