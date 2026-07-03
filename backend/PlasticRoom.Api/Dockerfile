FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PlasticRoom.Api.csproj .
RUN dotnet restore PlasticRoom.Api.csproj
COPY . .
RUN dotnet publish PlasticRoom.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
ENV DATA_PATH=/data
ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000
ENTRYPOINT ["dotnet", "PlasticRoom.Api.dll"]
