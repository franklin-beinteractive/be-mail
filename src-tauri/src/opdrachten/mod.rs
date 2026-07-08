//! Opdrachten-coördinatie (overgenomen uit het Milky-project, zie
//! D:\Desktop\milky\opdrachten-app-spec.md): klantopdrachten volgen van
//! binnenkomst tot afronding, met actielijst, wachtkamer en herinneringen.
//!
//! HARDE REGEL: deze module verstuurt nooit e-mail. Mailteksten worden alleen
//! klaargezet om handmatig te kopiëren en te plakken in een reply.

pub mod achtergrond;
pub mod commands;
pub mod db;
pub mod domein;
pub mod error;
pub mod models;
