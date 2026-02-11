# Cómo hacer reales tus cambios en GitHub (paso a paso)

Si ya hicimos cambios en esta carpeta local, **todavía falta subirlos a tu repositorio remoto** para que aparezcan en GitHub.

## 1) Verificar que estás en la rama correcta

```bash
git branch --show-current
```

En este proyecto estamos usando la rama `work`.

## 2) Revisar qué cambios tienes listos

```bash
git status
```

## 3) Guardar cambios (commit)

```bash
git add .
git commit -m "mensaje claro del cambio"
```

> Si ya hiciste commit antes, este paso te puede decir `nothing to commit` y está bien.

## 4) Conectar tu repo local con GitHub (solo la primera vez)

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
```

Si ya existe `origin`, actualiza la URL:

```bash
git remote set-url origin https://github.com/TU_USUARIO/TU_REPO.git
```

## 5) Subir la rama al remoto

```bash
git push -u origin work
```

Con eso, los cambios ya quedan visibles en GitHub.

## 6) (Opcional) Pasar `work` a `main`

### Desde terminal:

```bash
git checkout main
git pull origin main
git merge work
git push origin main
```

### O desde GitHub:

1. Entra al repo.
2. Crea un Pull Request de `work` hacia `main`.
3. Haz merge.

---

## Problema más común: "No veo nada en GitHub"

Casi siempre es por una de estas razones:

- No hay remoto configurado (`git remote -v` vacío).
- Se hizo commit local, pero faltó `git push`.
- Se subió a otra rama distinta a la que estás viendo en GitHub.

## Comandos de diagnóstico rápido

```bash
git remote -v
git branch --show-current
git log --oneline -n 5
```
