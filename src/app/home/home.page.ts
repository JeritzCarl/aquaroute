// import { Component, OnInit } from '@angular/core';
// import { IonicModule, AlertController } from '@ionic/angular';
// import { FormsModule } from '@angular/forms'
// import { CommonModule } from '@angular/common'
// import { FirestoreService, Item } from '../services/firestore.service';
// import { RouterModule } from '@angular/router'; 


// @Component({
//   selector: 'app-home',
//   templateUrl: './home.page.html',
//   styleUrls: ['./home.page.scss'],
//   standalone: true,
//   imports: [IonicModule, FormsModule, CommonModule, RouterModule],
// })

// export class HomePage implements OnInit {
//   items: Item[] =[];
//   newItem: Item = { name: '', description: ''};

//   constructor(private firestoreService: FirestoreService,
//               private alertController: AlertController) { }

//   ngOnInit() {
//     this.firestoreService.getItems().subscribe((data: Item[]) => {
//       this.items = data;
//     });
//   }
//   addItem() {
//     if (this.newItem.name && this.newItem.description) {
//       this.firestoreService.addItem(this.newItem);
//       this.newItem = { name: '', description: '' }; // reset form
//     }
//   }

//   async updateItem(item: Item) {
//     const alert = await this.alertController.create({
//       header: 'Update Item',
//       inputs: [
//         { name: 'name', type: 'text', value: item.name, placeholder: 'Name' },
//         { name: 'description', type: 'text', value: item.description, placeholder: 'Description' }
//       ],
//       buttons: [
//         {
//           text: 'Cancel',
//           role: 'cancel'
//         },
//         {
//           text: 'Update',
//           handler: (data) => {
//             const updatedItem: Item = {
//               id: item.id,
//               name: data.name,
//               description: data.description
//             };
//             this.firestoreService.updateItem(updatedItem);
//           }
//         }
//       ]
//     });

//     await alert.present();
//   }

//     deleteItem(id: string) {
//     this.firestoreService.deleteItem(id);
//   }
// }

import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonicModule, CommonModule, RouterModule],
})
export class HomePage {
  constructor(private router: Router) {}

  goToSignUp() {
    this.router.navigate(['/number-input']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}

