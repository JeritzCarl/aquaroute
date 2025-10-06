import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, collectionData, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface Item {
  id?: string;
  name: string;
  description: string;
}

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {

  private collectionName = 'items';


  constructor(private firestore: Firestore) {}


  addItem(item: Item) {
    const itemsCollection = collection(this.firestore, this.collectionName);
    return addDoc(itemsCollection, item);
  }

  getItems(): Observable<Item[]> {
    const itemsCollection = collection(this.firestore, this.collectionName);
    return collectionData(itemsCollection, { idField: 'id' }) as Observable<Item[]>;
  }

  updateItem(item: Item) {
    if (!item.id) return;
    const itemDoc = doc(this.firestore, `${this.collectionName}/${item.id}`);
    return updateDoc(itemDoc, {
      name: item.name,
      description: item.description
    });
  }

    deleteItem(id: string) {
    const itemDoc = doc(this.firestore, `${this.collectionName}/${id}`);
    return deleteDoc(itemDoc);
  }
}
