python -m http.server 5500
this command will run the site on port 5500

(dockers also runs on ports. probably we need to add this command to docker .yml file)


to stop:
Get-NetTCPConnection -LocalPort 5500 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }



