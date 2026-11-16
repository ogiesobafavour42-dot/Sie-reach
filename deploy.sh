#!/data/data/com.termux/files/usr/bin/bash
# Pushes this folder to your GitHub repo. Run:  bash deploy.sh
read -p "GitHub username: " U
read -p "Repo name (already created, empty): " R
read -s -p "GitHub token (hidden): " T; echo
rm -rf .git
git init -q && git add . && git -c user.name=tinito -c user.email=tinito@sitereach.app commit -qm sitereach && git branch -M main
git push "https://$U:$T@github.com/$U/$R.git" main && echo "DONE: code is on GitHub"
